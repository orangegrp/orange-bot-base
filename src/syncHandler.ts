import { WebSocketServer, WebSocket, RawData } from "ws";
import { readFileSync } from "fs";
import https from "https";
import tls, { type PeerCertificate } from "tls";
import JsonDataStorage, { type ParseSchema, type JsonSchema } from "./helpers/jsonDataStorage.js";
import { getLogger, type Logger } from "orange-common-lib";
import type { Bot } from "./bot";
import sleep from "./helpers/sleep.js";
import mapOperations from "./helpers/mapOperations.js";
import type { Module, ModuleData } from "./module.js";
import { ConfigValueScope } from "./ConfigStorage/types.js";
import type { InstanceName, UniqueString } from "./types.js";
import { Address4, Address6 } from "ip-address"

const CACHE_PATH = "./.cache/SyncHandler/p2p-cache.json";

const P2P_SYNC_PORT = Number.parseInt(process.env.P2P_SYNC_PORT || "0");
const P2P_MY_ADDRESS = process.env.P2P_MY_ADDRESS;
const P2P_PEERS = process.env.P2P_PEERS;
const P2P_PREFERRED_MODULES = process.env.P2P_PREFERRED_MODULES;
const PEER_RETRY_TIME = 25000; // how long to wait before retrying connections to other peers (after they all failed)
const P2P_HEARTBEAT_TIME = 10000; // heartbeat interval
const P2P_DEAD_TIME = 2000; // how long after last heartbeat to consider a peer dead
const P2P_GIVE_UP_TIME = 5000; // how long to wait after being unable to connect anywhere before assuming control of everything
const P2P_CHECK_TIME = 5000; // how often to check if peers dissappear

type MapUpdateAction = 'set' | 'delete' | 'clear' | 'notify'

interface MapUpdateEvent<K, V> {
    action: MapUpdateAction;
    key: K | null;
    value: V | null;
}

class ObservableMap<K, V> extends Map<K, V> {
    private listeners: Array<(event: MapUpdateEvent<K, V>) => void> = [];

    // Add a listener for updates
    addListener(callback: (event: MapUpdateEvent<K, V>) => void): void {
        this.listeners.push(callback);
    }

    // Remove a listener
    removeListener(callback: (event: MapUpdateEvent<K, V>) => void): void {
        this.listeners = this.listeners.filter(listener => listener !== callback);
    }

    // Notify all listeners of an update
    private notifyListeners(action: MapUpdateAction, key: K | null, value: V | null): void {
        this.listeners.forEach(listener => listener({ action, key, value }));
    }

    notify() {
        this.listeners.forEach(listener => listener({ action: "notify", key: null, value: null }));
    }

    // Override the set method
    set(key: K, value: V): this {
        super.set(key, value);
        this.notifyListeners('set', key, value); // Notify when a value is set
        return this;
    }

    // Override the delete method
    delete(key: K): boolean {
        const result = super.delete(key);
        if (result) {
            this.notifyListeners('delete', key, null); // Notify when a value is deleted
        }
        return result;
    }

    // Override the clear method
    clear(): void {
        super.clear();
        this.notifyListeners('clear', null, null); // Notify when the map is cleared
    }
}


const peerCacheSchema = {
    peers: [{
        name: "string",
        address: "string"
    }]
} satisfies JsonSchema

class Peer {
    name: InstanceName;
    address: PeerAddress | undefined;
    lastHeartbeat?: number;
    lastMessageId: number;
    modules?: Modules;
    knownDead: boolean;
    priority: number;
    constructor(name: InstanceName, address?: PeerAddress) {
        this.name = name;
        this.address = address;
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

type PeerAddress = UniqueString<"PeerAddress">;

type Modules = ModuleData[]
enum MessageType {
    hello,
    heartbeat,
    instanceInfo,
    lostPeer,
    assignModule,
    requestModule,
    controlSwitch,
    moduleInfo,
    expireConfigCache
};
type HelloMessage = {
    type: MessageType.hello,
    version: string,
    env: "prod" | "dev",
    userId: string,
};
type HeartbeatMessage = {
    type: MessageType.heartbeat,
    time: number,
};

type InstanceInfoMessage = {
    type: MessageType.instanceInfo,
    address: PeerAddress | undefined,
    priority: number,
    reply: boolean
};

type LostPeerMessage = {
    type: MessageType.lostPeer,
    peer: InstanceName
};

type AssignModuleMessage = {
    type: MessageType.assignModule,
    peer: InstanceName,
    module: string
};

type RequestModuleMessage = {
    type: MessageType.requestModule,
    module: string
}

type ControlSwitchMessage = {
    type: MessageType.controlSwitch,
    controller: InstanceName
};

type ModuleInfoMessage = {
    type: MessageType.moduleInfo,
    modules: Modules,
}

type ExpireConfigCacheMessage = {
    type: MessageType.expireConfigCache,
    configName: string,
    scope: ConfigValueScope,
    id: string
}

type Message = HelloMessage | HeartbeatMessage | InstanceInfoMessage | LostPeerMessage | AssignModuleMessage | RequestModuleMessage | ControlSwitchMessage | ModuleInfoMessage | ExpireConfigCacheMessage;

type MessageMeta = {
    source: InstanceName,
    id: number,
};

type FullMessage = Message & MessageMeta;

class SyncHandler {
    private readonly wsServer: WebSocketServer;
    private readonly logger;
    readonly client;
    readonly bot;
    readonly peers: Map<InstanceName, Peer>;
    private readonly peerCache;
    /** Who's in charge? */
    private controller: Peer | undefined;
    private readonly myself: Peer;
    private readonly server;
    private readonly preferredModules?: string[];
    readonly certs;

    private currentMessageId = 1;

    private readonly modules: Modules;

    constructor(bot: Bot) {
        this.bot = bot;
        this.logger = getLogger("SyncHandler");

        this.certs = loadCerts();

        this.peers = new Map();
        this.preferredModules = P2P_PREFERRED_MODULES?.replace(/ /g, "").split(",");

        this.peerCache = new JsonDataStorage(CACHE_PATH, peerCacheSchema, this.logger);
        this.peerCache.makeSureDataFileExists({ peers: [] });
        this.client = new SyncHandlerClient(this, this.logger);

        this.myself = this.createPeer(this.bot.instanceName, P2P_MY_ADDRESS as PeerAddress);
        this.myself.priority = Date.now();
        this.peers.set(this.bot.instanceName, this.myself);

        this.logger.log(`Instance: ${this.myself.name}`);
        this.logger.log(`Address: ${this.myself.address}`);
        this.logger.log(`Priority: ${this.myself.priority}`);


        this.bot.commandManager.handleAll = false;

        this.modules = [];
        for (const module of bot.modules.values()) {
            this.modules.push(module.data);
        }

        this.server = https.createServer({
            cert: this.certs.cert,
            key: this.certs.key,
            ca: this.certs.caCert,
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
                    env: this.bot.env,
                    userId: this.bot.client.user?.id || "",
                }, ws);
            });
            ws.on("close", () => this.checkStatus());
        });

        this.begin();
    }

    /** Am i in control? */
    get inControl() {
        return this.controller?.name == this.bot.instanceName;
    }

    get whoIsInControl() {
        return this.controller?.name;
    }

    private async begin() {
        for (const peer of (await this.peerCache.read()).peers) {
            if (this.peers.has(peer.name as InstanceName)) continue;
            this.createPeer(peer.name as InstanceName, peer.address as PeerAddress); 
        }

        if (P2P_PEERS) {
            let unknownNum = 1;
            for (const address of parsePeerAddresses(P2P_PEERS)) {
                const existingPeer = this.findPeerByAddress(address);
                if (existingPeer) { // the peer was already loaded from cache
                    continue;
                }
                this.createPeer("unknown-peer-" + unknownNum as InstanceName, address);
                unknownNum++;
            }
        }

        if (P2P_SYNC_PORT === 0) throw new Error("P2P_SYNC_PORT cannot be 0"); 

        this.server.listen(P2P_SYNC_PORT, () => {
            this.logger.log("listening on " + P2P_SYNC_PORT);
            this.heartbeat();
            this.client.connectNextPeer();
            setInterval(() => this.checkStatus(), P2P_CHECK_TIME);
        });

    }

    onMessage(message: FullMessage, rawMessage: RawData, source: WebSocket | "client", loop = false) {
        const peer = this.peers.get(message.source);
        if (!peer) {
            if (message.type == MessageType.instanceInfo && !loop) {
                this.createPeer(message.source, message.address, { updateCache: true });
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
            this.sendModules();
        }
        else if (message.type == MessageType.lostPeer) {
            const deadPeer = this.peers.get(message.peer);
            if (!deadPeer) {
                this.logger.warn(`${peer.fullName} told us ${message.peer} died, but we didn't even know it existed. Misconfiguration?`);
                return;
            }
            this.handleDeadPeer(deadPeer, true);
        }
        else if (message.type == MessageType.assignModule) {
            const module = this.bot.modules.get(message.module);

            if (message.peer == this.bot.instanceName) {
                if (!module) {
                    this.logger.error(`${peer.fullName} assigned us the module "${message.module}", but we don't have that module.`);
                    return;
                }
                this.logger.info(`${peer.fullName} assigned us the module "${message.module}".`);
                
                this.setModuleHandler(module, this.bot.instanceName);
                return;
            }

            if (!module) {
                return;
            }
            if (module.handling) {
                this.logger.info(`${peer.fullName} assigned the module "${message.module}" to "${message.peer}", not handling anymore.`);
                this.setModuleHandler(module, message.peer);
            }
        }
        else if (message.type == MessageType.requestModule) {
            if (!this.inControl) return; // only the controller can do this

            const module = this.bot.modules.get(message.module);
            if (!module) {
                this.logger.error(`${peer.fullName} requested a module that doesn't exist. ("${message.module}").`);
                return;
            }
            if (module.handling) {
                this.setModuleHandler(module, undefined);
            }
            this.sendMessage({
                type: MessageType.assignModule,
                peer: message.source,
                module: module.name
            });
            this.logger.info(`Assigned ${module.name} to ${message.source} as requested.`);
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
        else if (message.type == MessageType.moduleInfo) {
            for (const mdlData of message.modules) {
                const mdl = this.bot.modules.get(mdlData.name);
                if (!mdl) {
                    this.logger.warn(`${peer.fullName} told us they are${mdlData.handling ? " " : " not "}handling module "${mdlData.name}", but that module doesn't even exist. Misconfiguration?`);
                    continue;
                }
                if (!mdlData.handling) {
                    if (mdl.handler == peer.name) mdl.handler = undefined;
                    return;
                }
                if (mdl.handling) {
                    this.logger.log(`${peer.fullName} told us they are handling module "${mdlData.name}", But we're handling it.`);
                    
                    if (this.myself.priority < peer.priority) {
                        if (this.inControl) {
                            this.setModuleHandler(mdl, this.bot.instanceName);
                            this.sendModules();
                        }
                        this.sendMessage({
                            type: MessageType.requestModule,
                            module: mdlData.name
                        });
                    }
                    else {
                        this.setModuleHandler(mdl, peer.name);
                        this.logger.log(`Stopped handling module "${mdlData.name}".`);
                    }
                }
                else mdl.handler = message.source;
            }

            peer.modules = message.modules;
        }
        else if (message.type == MessageType.expireConfigCache) {
            const configStorage = this.bot.configApi.storages.get(message.configName);
            if (!configStorage) {
                this.logger.warn(`${peer.fullName} told us to expire config for ${message.configName}.${message.scope}.${message.id}, but we couldn't find a config by that name.`);
                return;
            }
            configStorage.expireCache(message.scope, message.id);
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
        this.sendModules();
        if (!this.preferredModules) return;
        for (const cmdName of this.preferredModules) {
            this.logger.log(`Requesting module "${cmdName}".`);
            this.sendMessage({
                type: MessageType.requestModule,
                module: cmdName
            });
        }
    }

    expireConfigCache(configName: string, scope: ConfigValueScope, id: string) {
        this.sendMessage({
            type: MessageType.expireConfigCache,
            configName: configName,
            scope: scope,
            id: id
        });
    }

    private setModuleHandler(mdl: Module, handler: InstanceName | undefined) {
        mdl.handler = handler;
        this.sendModules();
    }
    sendModules() {
        this.sendMessage({
            type: MessageType.moduleInfo,
            modules: this.modules
        });
    }

    async handlePeerConnectionFail() {
        if (this.modules.every(mdl => mdl.handling)) {
            // no need to do anything, we control everything already.
            // TODO: this wastes a tiny bit of resources by being ran constantly, fix?
            return;
        }

        await sleep(P2P_GIVE_UP_TIME);

        if (this.hasPeers()) {
            return;
        }

        this.logger.warn(`Peer connections failed, assuming control of all available modules.`);

        // i am the controller now

        for (const module of this.bot.modules.values()) {
            if (module.available) {
                module.handler = this.bot.instanceName;
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
        }, 10 * 1000)
    }

    private checkStatus() {
        for (const peer of this.peers.values()) {
            if (peer.alive) continue; // peer is alive, this is fine
            if (peer.knownDead) continue; // we already knew of this and it's been handled

            this.handleDeadPeer(peer);
        }
        if (this.inControl) this.checkModules();

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

        if (!peer.modules) return; // peer doesn't have modules, this is fine

        const peerHandledModules = peer.modules.filter(module => module.handling).map(module => module.name);
        if (peerHandledModules.length == 0) return; // peer wasn't handling anything, this is fine

        this.assignModules(peerHandledModules);
    }
    /** This should only be called if this.inControl
     * checks for unhandled modules and tries to assign them to instances
     */
    private checkModules() {
        const unhandledMdls: string[] = [];
        for (const mdl of this.bot.modules.values()) {
            if (mdl.handling) continue; // we are handling it

            if (mapOperations.some(this.peers, (name, peer) => {
                if (!peer.alive || !peer.modules) return false;
                return peer.modules.some(mdlData => mdlData.handling);
            })) continue; // someone else is handling it

            unhandledMdls.push(mdl.name);
        }

        this.assignModules(unhandledMdls);
    }
    /** This should only be called if this.inControl
     * Assigns modules to instances
     */
    private assignModules(modules: string[]) {
        for (const mdlName of modules) {
            const mdl = this.bot.modules.get(mdlName);
            if (!mdl) {
                this.logger.error(`Error assigning module "${mdlName}", it doesn't exist.`);
                continue;
            }
            if (!mdl.available) { // this module isn't available to us, get someone else to do it
                for (const peer of this.peers.values()) {
                    if (peer.alive && peer.modules && peer.modules.some(mdlData => mdlData.name === mdl.name && mdlData.available)) {
                        mdl.handler = peer.name;
                        this.sendMessage({ // tell them to handle it
                            type: MessageType.assignModule,
                            peer: peer.name,
                            module: mdlName
                        });
                        break;
                    }
                }
                mdl.handler = undefined;
                continue;
            }
            // assume control of the module ourselves
            mdl.handler = this.bot.instanceName;
        }
        this.sendModules();
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
    private createPeer(name: InstanceName, address: PeerAddress | undefined, opts?: { updateCache: boolean }) {
        const peer = new Peer(name, address);
        this.peers.set(name, peer);
        if (opts?.updateCache) {
            const peersArray = Array.from(this.peers.values()).filter(peer => (peer.address !== undefined && peer.address !== "")).map(peer => ({ name: peer.name, address: peer.address! }))
            this.peerCache.save({ peers: peersArray });
        }
        return peer;
    }
    renamePeer(peer: Peer, name: InstanceName, opts?: { updateCache: boolean }) {
        this.peers.delete(peer.name);
        this.peers.set(name, peer);
        if (opts?.updateCache) {
            const peersArray = Array.from(this.peers.values()).filter(peer => (peer.address !== undefined && peer.address !== "")).map(peer => ({ name: peer.name, address: peer.address! }))
            this.peerCache.save({ peers: peersArray });
        }
        return peer;
    }
    private findPeerByAddress(address: PeerAddress) {
        return mapOperations.find(this.peers, (_, peer) => peer.address === address)?.value;
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

        if (typeof (message) === "string") {
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

        if (peer.address === undefined || peer.address === "") {
            // peer does not have an address to connect to
            setImmediate(() => this.connectNextPeer());
            return;
        }

        this.logger.verbose(`Connecting to ${peer.fullName}`);
        try {
            this.ws = new WebSocket(`wss://${peer.address}`, {
                hostname: "orange-bot",
                ca: this.syncHandler.certs.caCert,
                cert: this.syncHandler.certs.clientCert,
                key: this.syncHandler.certs.clientKey,
                rejectUnauthorized: true,
                handshakeTimeout: 5000,
                checkServerIdentity: ((hostname: string, cert: PeerCertificate) => {
                    return tls.checkServerIdentity("orange-bot", cert);
                }) as any as () => boolean
            });
        }
        catch {
            return;
        }

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
                if (peer.name.startsWith("unknown-peer")) {
                    this.syncHandler.renamePeer(peer, message.source, { updateCache: true });
                }
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
        if (message.userId !== this.bot.client.user?.id) {
            this.logger.warn(`Peer instance ${peer.fullName} is on user "${message.userId}", we are "${this.bot.client.user?.id}", disconnecting...`);
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
            env: this.bot.env,
            userId: this.bot.client.user?.id || "",
        });
    }
}

function parsePeerAddresses(string: string): PeerAddress[] {
    const addresses = string.replace(/ /g, "").split(",");
    for (const address of addresses) {
        if (!(Address4.isValid(address) || Address6.isValid(address))) {
            throw new Error(`Peer address "${address}" is not valid.`);
        }
    }
    return addresses as PeerAddress[]
}

function loadCerts() {
    const caCert = readFileSync("./certs/ca.crt");
    const cert = readFileSync("./certs/orange-bot.crt");
    const key = readFileSync("./certs/orange-bot.key");
    const clientCert = readFileSync("./certs/orange-bot-client.crt");
    const clientKey = readFileSync("./certs/orange-bot-client.key");

    return {
        caCert, cert, key, clientCert, clientKey
    }
}

export { SyncHandler };