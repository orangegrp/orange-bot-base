// @ts nocheck
// TODO: remember to remove this
import { WebSocketServer, WebSocket, RawData } from "ws";
import { readFileSync } from "fs";
import https from "https";
import tls, { type PeerCertificate } from "tls";
import JsonDataStorage, { type ParseSchema, type JsonSchema } from "./helpers/jsonDataStorage.js";
import { getLogger, type Logger } from "orange-common-lib";
import type { Bot } from "./bot";
import sleep from "./helpers/sleep.js";
import mapOperations from "./helpers/mapOperations.js";
import { CommandWithExecutor } from "./commandManager.js";

const DATA_PATH = "./config/SyncHandler/p2p-config.json";

const caCert = readFileSync("./certs/ca.crt");
const cert = readFileSync("./certs/orange-bot.crt");
const key = readFileSync("./certs/orange-bot.key");
const clientCert = readFileSync("./certs/orange-bot-client.crt");
const clientKey = readFileSync("./certs/orange-bot-client.key");

const P2P_SYNC_PORT = Number.parseInt(process.env.P2P_SYNC_PORT || "4000");
const P2P_PRIORITY = Number.parseInt(process.env.P2P_PRIORITY || "0");
const P2P_MY_ADDRESS = process.env.P2P_MY_ADDRESS;
const PEER_RETRY_TIME = 60000; // how long to wait before retrying connections to other peers (after they all failed)
const P2P_HEARTBEAT_TIME = 10000; // heartbeat interval
const P2P_DEAD_TIME = 2000; // how long after last heartbeat to consider a peer dead
const P2P_GIVE_UP_TIME = 3000; // how long to wait after being unable to connect anywhere before assuming control of everything
const P2P_CHECK_TIME = 10000; // how often to check if peers dissappear


const p2pConfigSchema = {
    peers: [{
        name: "string",
        address: "string"
    }],
    priority: "number",
    port: "number",
    address: "string",
    preferredCommands: ["string"]
} satisfies JsonSchema

class Peer {
    name: string;
    address: string;
    lastHeartbeat?: number;
    lastMessageId: number;
    commands?: Commands;
    knownDead: boolean;
    priority: number;
    constructor(data: ParseSchema<typeof p2pConfigSchema.peers[0]>) {
        this.name = data.name;
        this.address = data.address;
        this.lastMessageId = 0;
        this.knownDead = false;
        this.priority = -1;
    }
    get alive(): boolean {
        return !this.knownDead && !!this.lastHeartbeat && this.lastHeartbeat > Date.now() - P2P_HEARTBEAT_TIME - P2P_DEAD_TIME;
    }
    get fullName(): string {
        return `${this.name} (${this.address})`;
    }
}
type Commands = {
    unavailable: string[],
    available: string[],
    handling: string[]
}
enum MessageType {
    hello,
    heartbeat,
    instanceInfo,
    lostPeer,
    assignCommand,
    requestCommand,
    controlSwitch,
    commandInfo
};
type HelloMessage = {
    type: MessageType.hello,
    version: string,
    env: "prod" | "dev",
};
type HeartbeatMessage = {
    type: MessageType.heartbeat,
    time: number,
};

type InstanceInfoMessage = {
    type: MessageType.instanceInfo,
    address: string,
    priority: number,
    reply: boolean
};

type LostPeerMessage = {
    type: MessageType.lostPeer,
    peer: string
};

type AssignCommandMessage = {
    type: MessageType.assignCommand,
    peer: string,
    command: string
};

type RequestCommandMessage = {
    type: MessageType.requestCommand,
    command: string
}

type ControlSwitchMessage = {
    type: MessageType.controlSwitch,
    controller: string
};

type CommandInfoMessage = {
    type: MessageType.commandInfo,
    commands: Commands,
}

type Message = HelloMessage | HeartbeatMessage | InstanceInfoMessage | LostPeerMessage | AssignCommandMessage | RequestCommandMessage | ControlSwitchMessage | CommandInfoMessage;

type MessageMeta = {
    source: string,
    id: number,
};

type FullMessage = Message & MessageMeta;

class SyncHandler {
    private readonly wsServer: WebSocketServer;
    private readonly logger;
    readonly client;
    readonly bot;
    readonly peers: Map<string, Peer>;
    private readonly storage;
    /** Who's in charge? */
    private controller: Peer | undefined;
    private readonly myself: Peer;
    private readonly server;
    private preferredCommands?: string[];

    private currentMessageId = 1;

    constructor(bot: Bot) {
        this.bot = bot;
        this.logger = getLogger("SyncHandler");
        this.peers = new Map();
        this.storage = new JsonDataStorage(DATA_PATH, p2pConfigSchema, this.logger);
        this.client = new SyncHandlerClient(this, this.logger);
        this.myself = new Peer({ address: "local", name: this.bot.instanceName });
        this.bot.commandManager.handleAll = false;

        for (const command of bot.commandManager.commands.values()) {
            if (command.unavailable) {
                this.commands.unavailable.push(command.name);
            }
            else {
                this.commands.available.push(command.name);
            }
        }

        this.server = https.createServer({
            cert: cert,
            key: key,
            ca: caCert,
            requestCert: true
        });

        this.wsServer = new WebSocketServer({
            server: this.server
        });

        this.wsServer.on("connection", ws => {
            let saidHello = false;
            ws.on("message", (data, isBinary) => {
                const message = JSON.parse(data.toString()) as FullMessage;
                // TODO: verify the message is good
                if (saidHello) 
                    return this.onMessage(message, data, ws);

                if (message.type !== MessageType.hello) {
                    ws.close();
                    return;
                }
                saidHello = true;
                this.sendMessageTo({
                    type: MessageType.hello,
                    version: this.bot.version,
                    env: this.bot.env
                }, ws);
            });
        });

        this.begin();
    }

    /** Am i in control? */
    private get inControl() {
        return this.controller?.name == this.bot.instanceName;
    }


    private get commands() {
        const commands: Commands = {
            unavailable: [],
            available: [],
            handling: []
        }
        for (const command of this.bot.commandManager.commands.values()) {
            if (command.unavailable) {
                commands.unavailable.push(command.name);
            }
            else {
                commands.available.push(command.name);
            }
            if (command.handling) {
                commands.handling.push(command.name);
            }
        }
        return commands;
    }
    private async begin() {
        const config = await this.loadConfig();

        this.server.listen(P2P_SYNC_PORT || config.port, () => {
            this.logger.log("listening on " + (P2P_SYNC_PORT || config.port));
            this.heartbeat();
            this.client.connectNextPeer();
            setInterval(() => this.checkStatus(), P2P_CHECK_TIME);
        });
        
    }
    async loadConfig() {
        const data = await this.storage.read();

        for (const peer of data.peers) {
            if (peer.name == this.bot.instanceName) continue;

            this.peers.set(peer.name, new Peer(peer));
        }
        this.myself.priority = P2P_PRIORITY || data.priority;
        this.myself.address = P2P_MY_ADDRESS || data.address;

        this.preferredCommands = data.preferredCommands;

        this.peers.set(this.bot.instanceName, this.myself);
        return data;
    }
    onMessage(message: FullMessage, rawMessage: RawData, source: WebSocket | "client", loop=false) {
        const peer = this.peers.get(message.source);
        if (!peer) {
            if (message.type == MessageType.instanceInfo && !loop) {
                this.peers.set(message.source, new Peer({ name: message.source, address: message.address }));
                this.logger.warn("Unknown peer: " + message.source);
                this.onMessage(message, rawMessage, source, true);
            }
            return;
        }

        if (message.source == this.bot.instanceName) return; // message looped around back to us, ignore
        if (peer.lastMessageId >= message.id) return; // duplicate message, ignore

        peer.lastMessageId = message.id;

        this.sendMessageRaw(rawMessage, source); // relay the message to others

        if (message.type == MessageType.heartbeat) {
            this.logger.verbose(`Heartbeat from: ${peer.name}`)
            peer.lastHeartbeat = Date.now();
            peer.knownDead = false;
        }
        else if (message.type == MessageType.instanceInfo) {
            this.logger.ok(`New peer: ${peer.fullName}.`);

            peer.lastHeartbeat = Date.now();
            peer.knownDead = false;

            peer.priority = message.priority;

            if (!this.controller || peer.priority < this.controller.priority) { 
                if (this.inControl) { // if we're currently the controller, tell everyone of the new one
                    this.sendMessage({
                        type: MessageType.controlSwitch,
                        controller: peer.name
                    });
                }
                if (this.myself.priority < peer.priority) {
                    this.assumeControl();
                }
                else {
                    this.setController(peer);
                }
            }

            if (message.reply) return;
            // tell everyone our status
            this.sendMessage({
                type: MessageType.instanceInfo,
                address: this.myself.address,
                priority: this.myself.priority,
                reply: true
            });
            this.sendCommands();
        }
        else if (message.type == MessageType.lostPeer) {
            const deadPeer = this.peers.get(message.peer);
            if (!deadPeer) {
                this.logger.warn(`${peer.fullName} told us ${message.peer} died, but we didn't even know it existed. Misconfiguration?`);
                return;
            }            
            this.handleDeadPeer(deadPeer, true);
        }
        else if (message.type == MessageType.assignCommand) {
            const command = this.bot.commandManager.commands.get(message.command);

            if (message.peer == this.bot.instanceName) {
                if (!command) {
                    this.logger.error(`${peer.fullName} assigned us the command "${message.command}", but we don't have that command.`);
                    return;
                }
                this.logger.info(`${peer.fullName} assigned us the command "${message.command}".`);
                
                this.handleCommand(command, true);
                return;
            }

            if (!command) { 
                return;
            }
            if (command.handling) {
                this.logger.info(`${peer.fullName} assigned the command "${message.command}" to "${message.peer}", not handling anymore.`);
                this.handleCommand(command, false);
            }
        }
        else if (message.type == MessageType.requestCommand) {
            if (!this.inControl) return; // only the controller can do this

            const command = this.bot.commandManager.commands.get(message.command);
            if (!command) {
                this.logger.error(`${peer.fullName} requested a command that doesn't exist. ("${message.command}").`);
                return;
            }
            if (command.handling) {
                this.handleCommand(command, false);
            }
            this.sendMessage({
                type: MessageType.assignCommand,
                peer: message.source,
                command: command.name
            });
            this.logger.info(`Assigned ${command.name} to ${message.source} as requested.`);
        }
        else if (message.type == MessageType.controlSwitch) {
            const controller = this.peers.get(message.controller);
            if (!controller) {
                this.logger.error(`${peer.fullName} told us ${message.controller} is the controller, but we didn't even know it existed. Out of sync?`);
                return;
            }

            if (this.myself.priority < controller.priority) {
                this.logger.error(`${peer.fullName} told us ${controller.fullName} is now the controller, but we have higher priority?`);
                return;
            }

            this.logger.info(`${peer.fullName} told us ${controller.fullName} is now the controller.`);

            this.setController(controller);

            if (controller.name == this.bot.instanceName) {
                this.logger.info("I have control.");
            }
        }
        else if (message.type == MessageType.commandInfo) {
            for (const cmdName of message.commands.handling) {
                const cmd = this.bot.commandManager.commands.get(cmdName);
                if (!cmd) {
                    this.logger.warn(`${peer.fullName} told us they are handling command "${cmdName}", but that command doesn't even exist. Misconfiguration?`);
                    continue;
                }
                if (cmd.handling) {
                    this.logger.log(`${peer.fullName} told us they are handling command "${cmdName}", But we're handling it.`);
                    
                    if (this.myself.priority < peer.priority) {
                        this.sendMessage({
                            type: MessageType.requestCommand,
                            command: cmdName
                        });
                    }
                    else {
                        this.handleCommand(cmd, false);
                        this.logger.log(`Stopped handling command "${cmdName}".`);
                    }
                }
            }

            peer.commands = message.commands;
        }
    }
    /** Called from SyncHandlerClient once it's connected. */
    onClientConnected(peer: Peer) {
        this.logger.log(`Connected to ${peer.fullName} as client.`);

        // tell everyone what we can do
        this.sendMessage({
            type: MessageType.instanceInfo,
            address: this.myself.address,
            priority: this.myself.priority,
            reply: false,
        });
        this.sendCommands();
        if (!this.preferredCommands) return;
        for (const cmdName of this.preferredCommands) {
            this.logger.log(`Requesting command "${cmdName}".`);
            this.sendMessage({
                type: MessageType.requestCommand,
                command: cmdName
            });
        }
    }

    private handleCommand(cmd: CommandWithExecutor<any>, handling: boolean) {
        this.sendCommands();
        cmd.handling = handling;
    }
    private sendCommands() {
        this.sendMessage({
            type: MessageType.commandInfo,
            commands: this.commands
        });
    }

    async handlePeerConnectionFail() {
        if (this.commands.available.length == this.commands.handling.length) {
            // no need to do anything, we control everything already.
            // TODO: this wastes a tiny bit of resources by being ran constantly, fix?
            return;
        }

        await sleep(P2P_GIVE_UP_TIME);

        if (this.hasPeers()) {
            return;
        }

        this.logger.warn(`Peer connections failed, assuming control of all available commands.`);

        // i am the controller now

        for (const command of this.bot.commandManager.commands.values()) {
            if (!command.unavailable) {
                command.handling = true;
            }
        }
        this.assumeControl();
    }

    /** If any peers are connected */
    private hasPeers() {
        for (const peer of this.peers.values()) {
            if (peer.alive) return true;
        }
    }

    private heartbeat() {
        setInterval(() => {
            this.sendMessage({
                type: MessageType.heartbeat,
                time: Date.now()
            });
        }, 10*1000)
    }

    private checkStatus() {
        for (const peer of this.peers.values()) {
            if (peer.alive) continue; // peer is alive, this is fine
            if (peer.knownDead) continue; // we already knew of this and it's been handled
            
            this.handleDeadPeer(peer);
        }
        if (this.inControl) this.checkCommands();

        if (!this.inControl) this.checkController();
    }

    private handleDeadPeer(peer: Peer, dontTell = false) {
        if (peer.name == this.bot.instanceName) {
            peer.knownDead = true;
            return;
        }
        if (peer.knownDead) return; // this has been handled already

        this.logger.warn(`Peer ${peer.fullName} died.`);

        peer.knownDead = true; 
        peer.lastMessageId = 0;

        if (!dontTell) {
            this.sendMessage({ // tell everyone this peer is gone
                type: MessageType.lostPeer,
                peer: peer.name
            });
        }

        if (peer == this.controller) { // the controller died, figure out who's next
            this.checkController();
            return;
        }

        if (!this.inControl) return; // I am not in control, someone else will handle this

        if (!peer.commands) return; // peer doesn't have commands, this is fine
        if (peer.commands.handling.length == 0) return; // peer wasn't handling anything, this is fine

        this.assignCommands(peer.commands.handling);
    }
    /** This should only be called if this.inControl
     * checks for unhandled commands and tries to assign them to instances
     */
    private checkCommands() {
        const unhandledCmds: string[] = [];
        for (const cmd of this.bot.commandManager.commands.values()) {
            if (cmd.handling) continue; // we are handling it

            if (mapOperations.some(this.peers, (name, peer) => {
                if (!peer.alive || !peer.commands) return false;
                return peer.commands.handling.includes(cmd.name);
            })) continue; // someone else is handling it

            unhandledCmds.push(cmd.name);
        }

        this.assignCommands(unhandledCmds);
    }
    /** This should only be called if this.inControl
     * Assigns commands to instances
     */
    private assignCommands(commands: string[]) {
        for (const cmdName of commands) {
            const cmd = this.bot.commandManager.commands.get(cmdName);
            if (!cmd) {
                this.logger.error(`Error assigning command "${cmdName}", it doesn't exist.`);
                continue;
            }
            if (cmd.unavailable) { // this command isn't available to us, get someone else to do it
                for (const peer of this.peers.values()) {
                    if (peer.alive && peer.commands && peer.commands.available.includes(cmdName)) {
                        this.sendMessage({ // tell them to handle it
                            type: MessageType.assignCommand,
                            peer: peer.name,
                            command: cmdName
                        });
                    }
                }
                continue;
            }
            // assume control of the command ourselves
            cmd.handling = true;
        }
        this.sendCommands();
    }
    private checkController() {
        let willControl = true;
        for (const p of this.peers.values()) {
            if (p.alive && p.priority < this.myself.priority) {
                willControl = false;
                break;
            }
        }
        if (willControl) {
            this.assumeControl();
        }
    }
    private assumeControl() {
        this.logger.log("Assuming control.");
        this.controller = this.myself;
        this.sendMessage({
            type: MessageType.controlSwitch,
            controller: this.bot.instanceName
        });
    }
    private setController(peer: Peer) {
        this.logger.ok(`${peer.fullName} is now the controller.`);
        this.controller = peer;
    }

    private messageToData(message: Message): string {
        const fullMessage = message as FullMessage;
        fullMessage.source = this.bot.instanceName;
        fullMessage.id = this.messageId(); 
        return JSON.stringify(fullMessage);
    }
    private sendMessage(message: Message, except?: WebSocket | "client") {
        this.sendMessageRaw(this.messageToData(message), except);
    }
    private sendMessageRaw(message: RawData | string, except?: WebSocket | "client") {
        if (except !== "client")
        this.client.sendMessageRaw(message);

        for (const client of this.wsServer.clients) {
            if (except === client) continue;
            if (client.readyState == WebSocket.OPEN) client.send(message);
        }
    }
    private sendMessageTo(message: Message, ws: WebSocket) {
        ws.send(this.messageToData(message));
    }
    private messageId() {
        return this.currentMessageId++;
    }
}

class SyncHandlerClient {
    private peerIter?: Iterator<Peer, Peer>;
    private ws?: WebSocket;
    private readonly logger: Logger;
    private readonly syncHandler: SyncHandler;
    private readonly bot: Bot;
    
    constructor(syncHandler: SyncHandler, logger: Logger) {
        this.syncHandler = syncHandler;
        this.bot = this.syncHandler.bot;
        this.logger = logger.sublogger("client");
    }
    private nextPeer(): Peer | undefined {
        if (!this.peerIter) this.peerIter = this.syncHandler.peers.values();
        const next = this.peerIter.next();
        if (next.done) this.peerIter = undefined;
        return next.value;
    }
    
    sendMessage(message: FullMessage | RawData | string) {
        if (!this.ws || this.ws.readyState != WebSocket.OPEN) return false;

        if (typeof(message) === "string") {
            this.ws.send(message);
            return true;
        }
        
        this.ws.send(JSON.stringify(message));
        return true;
    }
    sendMessageRaw(message: RawData | string) {
        if (!this.ws || this.ws.readyState != WebSocket.OPEN) return false;
        
        this.ws.send(message);
        return true;
    }
    connectNextPeer() {
        const peer = this.nextPeer();

        if (!peer) {
            // last peer reached
            setTimeout(() => this.connectNextPeer(), PEER_RETRY_TIME);
            this.syncHandler.handlePeerConnectionFail();
            return;
        }

        if (peer.name == this.bot.instanceName) {
            // peer is ourselves, next.
            setImmediate(() => this.connectNextPeer());
            return;
        }
        
        this.logger.verbose(`Connecting to ${peer.fullName}`);

        this.ws = new WebSocket(`wss://${peer.address}`, { 
            hostname: "orange-bot",
            ca: caCert,
            cert: clientCert,
            key: clientKey,
            rejectUnauthorized: true,
            timeout: 5000,
            checkServerIdentity: ((hostname: string, cert: PeerCertificate) => {
                return tls.checkServerIdentity("orange-bot", cert);
            }) as any as () => boolean
        });

        this.ws.on("open", () => {
            this.sendHello();
        });

        this.ws.on("close", (code, reason) => {
            this.connectNextPeer();
        });

        this.ws.on("error", err => {
            this.logger.verbose(`Connection to ${peer.fullName} failed.`)
        })

        let gotHello = false;

        this.ws.on("message", (data, isBinary) => {
            const message = JSON.parse(data.toString()) as FullMessage;
            // TODO: verify the message is good
            
            if (gotHello) 
                this.syncHandler.onMessage(message, data, "client");
            
            if (message.type === MessageType.hello) {
                gotHello = this.processHello(message, peer);
                if (gotHello) this.syncHandler.onClientConnected(peer);
            }
        });
    }
    private processHello(message: HelloMessage & MessageMeta, peer: Peer): boolean {
        if (message.source === this.syncHandler.bot.instanceName) {
            // whoops! we have connected to ourselves
            this.ws?.close();
            return false;
        }
        if (message.version !== this.bot.version) {
            this.logger.warn(`Peer instance ${peer.fullName} is on a different version (${message.version}), disconnecting...`);
            this.ws?.close();
            return false;
        } 
        if (message.version !== this.bot.version) {
            this.logger.warn(`Peer instance ${peer.fullName} is on "${message.env}", we are "${this.bot.env}", disconnecting...`);
            this.ws?.close();
            return false;
        }

        if (message.source !== peer.name) {
            // some idiot configured it wrong
            this.logger.warn(`Instance we know as ${peer.name} (${peer.address}) claims to be ${message.source}, assuming it's been misconfigured.`);
            // rename the peer
            this.syncHandler.peers.delete(peer.name);
            peer.name = message.source;
            this.syncHandler.peers.set(peer.name, peer);
            
            // in case this ever crashes it, uncomment following line:
            // this.peerIter = undefined;
        }

        return true;
    }
    private async sendHello() {
        this.sendMessage({ 
            type: MessageType.hello,
            source: this.bot.instanceName,
            id: 0,
            version: this.bot.version,
            env: this.bot.env
        });
    }
}

export { SyncHandler };