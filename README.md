<!--
    Written by: strbit <int@skrd.dev>
    ✦ © 2024 nothing™ ✦
-->

## Telegram Downtime(r)

✦ Imagine this scenario, you've deployed on a Friday evening *(rookie mistake)*, went to bed and woke up realizing your beloved Telegram bot, due to some unhandled error, has been down for the past 9 hours with no sort of announcement sent out to the users. *Very, very awkward.*

>[!NOTE]
> ⌘ This was initially built for personal projects deployed on [Railway][railway] and will **definitely** not work as expected on other hosting providers, you **will need to** tweak the code to fit this project to your needs. Pull-requests to make this bot more extensible are always welcome.

This is a very small server which will listen for incoming downtime updates *(essentially HTTP requests)* which are sent by your main bot whenever it comes across, for example, an uncaught exception (via `process.on('uncaughtException')`. Once a request is received, the downtime will be started or stopped according to the body sent with the request.

Here's a simple method of sending downtime updates to this server:

```ts
/**
 * Fired whenever the bot unexpectedly goes down (e.x. via an `uncaughtException` event)
 * or instead, comes back up. This function will send a status update to the
 * downtime handler which will (if the bot is experiencing downtime) take over
 * and respond to incoming messages with a downtime notice.
 *
 * You can also fire this function manually to represent maintenance or similar.
 * Make sure you have a way of stopping the downtime, perhaps by restarting the
 * bot. Sending manual requests is NOT possible as they are sent to an internal
 * network.
 *
 * @async
 * @function sendDowntimeUpdate
 * @param down - Whether the bot is currently down or not.
 * @returns Nothing.
 *
 * @example
 * ```ts
 * process.on('uncaughtException', async (err) => {
 *     console.log("I told you to not deploy on a Friday!", err);
 *     await sendDowntimeUpdate(true); // tell the downtime server that the bot is down.
 * });
 * ```
 */
export async function sendDowntimeUpdate(down: boolean): Promise<void> {
    /**
     * The **internal** domain, located on an **internal** network which would restrict any
     * manual request(s) made to this endpoint. Private networks are secure out of the box.
     */
    const networkDomain = `http://${config.DOWNTIME_HOST}:${config.DOWNTIME_PORT}`;
    /** The endpoint to which downtime updates are sent. */
    const downtimeEndpoint = new URL('downtime', networkDomain).href;
    /**
     * Data to pass alongside with the request. This is only the request's body, not the
     * configuration. Headers, cookies, etc. must be set within the request itself.
     */
    const updateBodyData = {
        down, // new downtime state.
    };

    // send the request to the downtime handler.
    await axios.post(downtimeEndpoint, updateBodyData).catch((err) => {
        // handle an error accordingly.
        console.error(
            "Couldn't send the downtime update, make sure your downtime handler is reachable.",
            err
        );
    });
}
```

Using whatever method of error handling, whether the native `process.on()` or a custom implementation, simply call this function and pass a `boolean` to send a downtime update. This bot will handle everything else.

### As for chat member updates:

✦ Don't forget that people will still block your bot, everytime that happens, this bot will update their block status in the connected database. **You will have to update the field which represents a user's block status.**

<!-- Re-used links. -->
[railway]: https://railway.app/
