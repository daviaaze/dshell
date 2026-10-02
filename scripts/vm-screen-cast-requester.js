import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const PORTAL_BUS = 'org.freedesktop.portal.Desktop';
const PORTAL_PATH = '/org/freedesktop/portal/desktop';
const SCREEN_CAST = 'org.freedesktop.portal.ScreenCast';
const REQUEST = 'org.freedesktop.portal.Request';
const SESSION = 'org.freedesktop.portal.Session';

let connection;

function log(message) {
    print(`[shade-vm-screen-cast] ${message}`);
}

function makeToken(label) {
    return `shade_vm_${label}_${GLib.uuid_string_random().replace(/-/g, '')}`;
}

function makeOptions(handleToken, extra = {}) {
    return new GLib.Variant('a{sv}', {
        handle_token: new GLib.Variant('s', handleToken),
        ...extra,
    });
}

function requestPath(handleToken) {
    const uniqueName = connection.get_unique_name();
    if (!uniqueName || !uniqueName.startsWith(':')) {
        throw new Error(`Session bus returned an invalid unique name: ${uniqueName}`);
    }

    const sender = uniqueName.slice(1).replace(/\./g, '_');
    return `${PORTAL_PATH}/request/${sender}/${handleToken}`;
}

function portalRequest(method, signature, args, handleToken) {
    return new Promise((resolve, reject) => {
        const expectedPath = requestPath(handleToken);
        const parameters = new GLib.Variant(signature, args);
        let subscription = 0;
        let methodReturned = false;
        let responseReceived = false;
        let completed = false;
        let response;

        const unsubscribe = () => {
            if (subscription !== 0) {
                connection.signal_unsubscribe(subscription);
                subscription = 0;
            }
        };
        const fail = (error) => {
            if (completed) return;
            completed = true;
            unsubscribe();
            reject(error);
        };
        const finish = () => {
            if (completed || !methodReturned || !responseReceived) return;
            completed = true;
            unsubscribe();
            resolve(response);
        };

        log(`PORTAL REQUEST ${SCREEN_CAST}.${method} ${parameters.print(true)}`);

        try {
            // Subscribe first so a fast backend cannot emit Response before we listen.
            subscription = connection.signal_subscribe(
                PORTAL_BUS,
                REQUEST,
                'Response',
                expectedPath,
                null,
                Gio.DBusSignalFlags.NONE,
                (_bus, _sender, _path, _interface, _signal, signalParameters) => {
                    if (completed || responseReceived) return;
                    const code = signalParameters.get_child_value(0).get_uint32();
                    const results = signalParameters.get_child_value(1);
                    log(`PORTAL RESPONSE ${SCREEN_CAST}.${method} code=${code} results=${results.print(true)}`);
                    response = { code, results };
                    responseReceived = true;
                    finish();
                }
            );

            connection.call(
                PORTAL_BUS,
                PORTAL_PATH,
                SCREEN_CAST,
                method,
                parameters,
                new GLib.VariantType('(o)'),
                Gio.DBusCallFlags.NONE,
                -1,
                null,
                (bus, result) => {
                    try {
                        const reply = bus.call_finish(result);
                        const returnedPath = reply.deep_unpack()[0];
                        log(`PORTAL METHOD RETURN ${SCREEN_CAST}.${method} request=${returnedPath}`);
                        if (returnedPath !== expectedPath) {
                            throw new Error(`${method} returned ${returnedPath}; expected ${expectedPath}`);
                        }
                        methodReturned = true;
                        finish();
                    } catch (error) {
                        fail(error);
                    }
                }
            );
        } catch (error) {
            fail(error);
        }
    });
}

function resultString(results, key) {
    for (const type of ['s', 'o']) {
        const value = results.lookup_value(key, new GLib.VariantType(type));
        if (value !== null) return value.deep_unpack();
    }

    const unpacked = results.deep_unpack();
    if (typeof unpacked[key] === 'string') return unpacked[key];
    throw new Error(`Portal response omitted string result '${key}'`);
}

function callSessionClose(sessionHandle) {
    const parameters = new GLib.Variant('()', []);
    log(`PORTAL REQUEST ${SESSION}.Close session=${sessionHandle}`);

    return new Promise((resolve, reject) => {
        connection.call(
            PORTAL_BUS,
            sessionHandle,
            SESSION,
            'Close',
            parameters,
            new GLib.VariantType('()'),
            Gio.DBusCallFlags.NONE,
            -1,
            null,
            (bus, result) => {
                try {
                    bus.call_finish(result);
                    log(`PORTAL RESPONSE ${SESSION}.Close session=${sessionHandle} closed`);
                    resolve();
                } catch (error) {
                    log(`PORTAL RESPONSE ${SESSION}.Close session=${sessionHandle} error=${error.message}`);
                    reject(error);
                }
            }
        );
    });
}

async function requestScreenCast() {
    connection = Gio.bus_get_sync(Gio.BusType.SESSION, null);
    log(`connected to session bus as ${connection.get_unique_name()}`);

    const createToken = makeToken('create');
    const createOptions = makeOptions(createToken, {
        session_handle_token: new GLib.Variant('s', makeToken('session')),
    });
    const create = await portalRequest(
        'CreateSession',
        '(a{sv})',
        [createOptions],
        createToken
    );

    if (create.code === 1) {
        log('CreateSession was cancelled; no session was created');
        return;
    }
    if (create.code !== 0) {
        throw new Error(`CreateSession failed with portal response code ${create.code}`);
    }

    const sessionHandle = resultString(create.results, 'session_handle');
    log(`created portal session ${sessionHandle}`);

    try {
        const selectToken = makeToken('select');
        const selectOptions = makeOptions(selectToken, {
            types: new GLib.Variant('u', 3), // MONITOR | WINDOW
            multiple: new GLib.Variant('b', false),
        });
        const select = await portalRequest(
            'SelectSources',
            '(oa{sv})',
            [new GLib.Variant('o', sessionHandle), selectOptions],
            selectToken
        );

        if (select.code === 1) {
            log('SelectSources was cancelled; closing the session');
            return;
        }
        if (select.code !== 0) {
            throw new Error(`SelectSources failed with portal response code ${select.code}`);
        }

        const startToken = makeToken('start');
        const startOptions = makeOptions(startToken);
        const start = await portalRequest(
            'Start',
            '(osa{sv})',
            [new GLib.Variant('o', sessionHandle), new GLib.Variant('s', ''), startOptions],
            startToken
        );

        if (start.code === 1) {
            log('Start was cancelled in the guest share picker; closing the session');
            return;
        }
        if (start.code !== 0) {
            throw new Error(`Start failed with portal response code ${start.code}`);
        }

        log('Start accepted the guest screen/window selection; closing the session without opening a PipeWire remote');
    } finally {
        // The ScreenCast portal has no Stop method; Session.Close ends its active streams.
        await callSessionClose(sessionHandle);
    }
}

const mainLoop = new GLib.MainLoop(null, false);
let failure = null;
let finished = false;

requestScreenCast().then(
    () => {
        finished = true;
        if (mainLoop.is_running()) mainLoop.quit();
    },
    (error) => {
        failure = error;
        finished = true;
        if (mainLoop.is_running()) mainLoop.quit();
    }
);

if (!finished) mainLoop.run();
if (failure !== null) {
    printerr(`[shade-vm-screen-cast] FATAL ${failure.message ?? failure}`);
    throw failure;
}
