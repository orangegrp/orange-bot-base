
/**
 * Throwing this error in a command executor will show the message on discord.
 * 
 * This is only meant for handling cases where an errors was thrown ALREADY, and not as a result for bad input, etc.
 */
class DisplayError extends Error {
    /**
     * @param message Message to show
     * @param original The original error object, for logging
     */
    constructor(message: string);
    /**
     * @param message Message to show
     * @param original The original error object, for logging
     */
    constructor(message: string, original: Error);
    constructor(message: string, readonly original?: Error) {
        super(message);
    }
}   

export { DisplayError };