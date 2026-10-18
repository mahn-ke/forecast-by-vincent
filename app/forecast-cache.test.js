import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createForecastCache, forecastResponseHeaders } from './forecast-cache.js';

const location = { x: 9.99, y: 53.55 };

function setup(t, time = '2026-10-18T13:00:00Z') {
    t.mock.timers.enable({ apis: ['Date'], now: new Date(time) });
    t.mock.method(console, 'info', function () {});
    t.mock.method(console, 'warn', function () {});
}

function forecast(id = 'new') {
    const start = Math.ceil(Date.now() / 300000) * 300;
    return {
        data: Buffer.from(id),
        ...location,
        zoom: 10,
        sourceZoom: 10,
        start: start,
        end: start + 5400,
        frames: 19
    };
}

test('fresh requests reuse the video until the next five-minute boundary', async function (t) {
    setup(t, '2026-10-18T13:00:30Z');
    const generate = t.mock.fn(async () => forecast());
    const get = createForecastCache(generate);
    const first = await get(location);
    assert.equal(first.result.expiresAt, Date.parse('2026-10-18T13:05:00Z'));
    assert.equal(first.result.staleUntil, Date.parse('2026-10-18T13:06:00Z'));
    t.mock.timers.setTime(Date.parse('2026-10-18T13:04:59.999Z'));
    assert.deepEqual(await get(location), first);
    assert.equal(generate.mock.callCount(), 1);
});

test('a 17:00 request waits for regeneration instead of returning the 13:00 video', async function (t) {
    setup(t);
    const pending = Promise.withResolvers();
    const generate = t.mock.fn(async () => forecast('13:00'));
    const get = createForecastCache(generate);
    const first = await get(location);
    t.mock.timers.setTime(Date.parse('2026-10-18T17:00:00Z'));
    generate.mock.mockImplementation(() => pending.promise);
    const response = get(location);
    let settled = false;
    response.then(() => { settled = true; });
    await Promise.resolve();
    assert.equal(settled, false);
    pending.resolve(forecast('17:00'));
    const next = await response;
    assert.equal(next.result.data.toString(), '17:00');
    assert.notEqual(next.result.etag, first.result.etag);
    assert.equal(next.stale, false);
    assert.equal(generate.mock.callCount(), 2);
});

test('stale responses are allowed only during the 60-second grace, with one shared refresh', async function (t) {
    setup(t);
    const pending = Promise.withResolvers();
    const generate = t.mock.fn(async () => forecast('old'));
    const get = createForecastCache(generate);
    const first = await get(location);
    generate.mock.mockImplementation(() => pending.promise);
    t.mock.timers.setTime(Date.parse('2026-10-18T13:05:00Z'));
    assert.deepEqual(await get(location), { result: first.result, stale: true });
    t.mock.timers.setTime(Date.parse('2026-10-18T13:05:59.999Z'));
    assert.deepEqual(await get(location), { result: first.result, stale: true });
    assert.equal(generate.mock.callCount(), 2);
    t.mock.timers.setTime(Date.parse('2026-10-18T13:06:00Z'));
    const response = get(location);
    const concurrentResponse = get(location);
    pending.resolve(forecast('refreshed'));
    const next = await response;
    assert.equal(next.result.data.toString(), 'refreshed');
    assert.equal(next.stale, false);
    assert.deepEqual(await concurrentResponse, next);
    assert.equal(generate.mock.callCount(), 2);
});

for (const [generatedAt, cutoff] of [
    ['2026-10-18T12:59:30Z', '2026-10-18T13:01:00Z'],
    ['2026-10-18T13:04:30Z', '2026-10-18T13:06:00Z'],
    ['2026-10-18T13:09:30Z', '2026-10-18T13:11:00Z'],
    ['2026-10-18T23:59:30Z', '2026-10-19T00:01:00Z']
]) {
    test('old cache is rejected exactly at ' + cutoff, async function (t) {
        setup(t, generatedAt);
        const generate = t.mock.fn(async () => forecast(String(Date.now())));
        const get = createForecastCache(generate);
        const first = await get(location);
        assert.equal(first.result.staleUntil, Date.parse(cutoff));
        t.mock.timers.setTime(Date.parse(cutoff));
        const next = await get(location);
        assert.notEqual(next.result.etag, first.result.etag);
        assert.equal(next.stale, false);
        assert.equal(generate.mock.callCount(), 2);
    });
}

test('failed regeneration after the cutoff rejects instead of falling back, and can retry', async function (t) {
    setup(t);
    const generate = t.mock.fn(async () => forecast('old'));
    const get = createForecastCache(generate);
    await get(location);
    t.mock.timers.setTime(Date.parse('2026-10-18T13:06:00Z'));
    const failure = new Error('Provider unavailable');
    generate.mock.mockImplementation(async () => { throw failure; });
    await assert.rejects(get(location), failure);
    generate.mock.mockImplementation(async () => forecast('recovered'));
    assert.equal((await get(location)).result.data.toString(), 'recovered');
    assert.equal(generate.mock.callCount(), 3);
});

test('renders completing after their cutoff are discarded and regenerated', async function (t) {
    setup(t);
    const pending = Promise.withResolvers();
    const generate = t.mock.fn(() => pending.promise);
    const get = createForecastCache(generate);
    const response = get(location);
    const old = forecast('slow');
    t.mock.timers.setTime(Date.parse('2026-10-18T13:06:00Z'));
    generate.mock.mockImplementation(async () => forecast('current'));
    pending.resolve(old);
    const next = await response;
    assert.equal(next.result.data.toString(), 'current');
    assert.equal(next.stale, false);
    assert.equal(next.result.expiresAt, Date.parse('2026-10-18T13:10:00Z'));
    assert.equal(generate.mock.callCount(), 2);
    assert.deepEqual(await get(location), next);
    assert.equal(generate.mock.callCount(), 2);
});

test('a failed background refresh is logged and cannot extend the grace', async function (t) {
    setup(t);
    const logged = Promise.withResolvers();
    const logError = t.mock.method(console, 'error', function (...args) { logged.resolve(args); });
    const generate = t.mock.fn(async () => forecast('old'));
    const get = createForecastCache(generate);
    await get(location);
    const failure = new Error('Provider unavailable');
    generate.mock.mockImplementation(async () => { throw failure; });
    t.mock.timers.setTime(Date.parse('2026-10-18T13:05:00Z'));
    assert.equal((await get(location)).stale, true);
    assert.equal((await logged.promise)[1], failure);
    assert.equal(logError.mock.callCount(), 1);
    t.mock.timers.setTime(Date.parse('2026-10-18T13:06:00Z'));
    await assert.rejects(get(location), failure);
    assert.equal(generate.mock.callCount(), 3);
});

test('renders finishing during the grace are marked stale', async function (t) {
    setup(t);
    const pending = Promise.withResolvers();
    const get = createForecastCache(() => pending.promise);
    const response = get(location);
    const result = forecast();
    t.mock.timers.setTime(Date.parse('2026-10-18T13:05:30Z'));
    pending.resolve(result);
    assert.equal((await response).stale, true);
});

test('cache keys separate locations and explicit zooms', async function (t) {
    setup(t);
    const generate = t.mock.fn(async () => forecast());
    const get = createForecastCache(generate);
    await get(location);
    await get({ ...location, zoom: 10 });
    await get({ ...location, x: 10 });
    await get(location);
    assert.equal(generate.mock.callCount(), 3);
});

test('cache keys separate themes and treat a missing theme as light', async function (t) {
    setup(t);
    const generate = t.mock.fn(async (requested) => ({ ...forecast(), theme: requested.theme }));
    const get = createForecastCache(generate);
    await get(location);
    await get({ ...location, theme: 'light' });
    const dark = await get({ ...location, theme: 'dark' });
    await get({ ...location, theme: 'dark' });
    assert.equal(generate.mock.callCount(), 2);
    assert.equal(forecastResponseHeaders(dark.result, dark.stale)['X-Forecast-Theme'], 'dark');
});

test('the eight-entry LRU cache retains recently accessed locations', async function (t) {
    setup(t);
    const generate = t.mock.fn(async () => forecast());
    const get = createForecastCache(generate);
    for (let x = 0; x < 8; x += 1) await get({ ...location, x: x });
    await get({ ...location, x: 0 });
    await get({ ...location, x: 8 });
    await get({ ...location, x: 0 });
    assert.equal(generate.mock.callCount(), 9);
    await get({ ...location, x: 1 });
    assert.equal(generate.mock.callCount(), 10);
});

test('cache keys separate labels and treat a missing label as disabled', async function (t) {
    setup(t);
    const generate = t.mock.fn(async (requested) => ({ ...forecast(), label: requested.label }));
    const get = createForecastCache(generate);
    const defaultResponse = await get(location);
    assert.deepEqual(await get({ ...location, label: 0 }), defaultResponse);
    const labeled = await get({ ...location, label: 1 });
    assert.deepEqual(await get({ ...location, label: 1 }), labeled);
    assert.equal(generate.mock.callCount(), 2);
    assert.equal(forecastResponseHeaders(defaultResponse.result, false)['X-Forecast-Label'], '0');
    assert.equal(forecastResponseHeaders(labeled.result, false)['X-Forecast-Label'], '1');
});

test('concurrent generations are shared only within the same label setting', async function (t) {
    setup(t);
    const pending = Promise.withResolvers();
    const generate = t.mock.fn(async (requested) => {
        await pending.promise;
        return { ...forecast(), label: requested.label };
    });
    const get = createForecastCache(generate);
    const responses = [get(location), get({ ...location, label: 0 }), get({ ...location, label: 1 })];
    assert.equal(generate.mock.callCount(), 2);
    pending.resolve();
    const [defaultResponse, disabled, enabled] = await Promise.all(responses);
    assert.deepEqual(defaultResponse, disabled);
    assert.notStrictEqual(defaultResponse.result, enabled.result);
});

test('HTTP headers enforce revalidation without an additional stale window', async function (t) {
    setup(t, '2026-10-18T13:00:30Z');
    const get = createForecastCache(async () => forecast());
    const { result } = await get(location);
    const fresh = forecastResponseHeaders(result, false);
    assert.equal(fresh['Cache-Control'], 'public, max-age=270, must-revalidate');
    assert.equal(fresh['Expires'], 'Sun, 18 Oct 2026 13:05:00 GMT');
    assert.equal(fresh['X-Forecast-Cache-Until'], '2026-10-18T13:06:00.000Z');
    assert.equal(fresh['X-Forecast-Stale'], 'false');
    assert.equal(fresh['Content-Length'], result.data.length);
    assert.equal(fresh['ETag'], result.etag);
    t.mock.timers.setTime(Date.parse('2026-10-18T13:05:30Z'));
    const stale = forecastResponseHeaders(result, true);
    assert.equal(stale['Cache-Control'], 'public, max-age=0, must-revalidate');
    assert.equal(stale['X-Forecast-Stale'], 'true');
});
