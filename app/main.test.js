import assert from 'node:assert/strict';
import http from 'node:http';
import { test } from 'node:test';
import sharp from 'sharp';

test('forecast labels are opt-in in HTTP requests and rendered GIFs', async function (t) {
    t.mock.method(console, 'info', function () {});
    t.mock.method(console, 'error', function () {});
    let handler;
    t.mock.method(http, 'createServer', function (callback) {
        handler = callback;
        return { listen() {} };
    });

    const tile = await sharp({
        create: { width: 512, height: 512, channels: 4, background: '#80a0c0' }
    }).png().toBuffer();
    const geo = {
        minZoom: 2,
        maxZoom: 2,
        staticLayer: {
            path: 'static',
            lsmTopography: { path: 'sea' },
            rrTopography: { path: 'topo', type: ['png'] },
            rrGeooverlay: { currentVersion: 'test' }
        },
        timeRangeConfig: {
            periodCurrentHighRes: { timeResolution: { 2: 5 } },
            periodCurrentLowRes: { timeResolution: { 2: 15 } }
        }
    };
    const future = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    const frameId = future.slice(0, 10).replaceAll('-', '') + '-' +
        future.slice(11, 16).replace(':', '') + '-test';
    const period = { timesteps: [{ id: frameId, layers: {} }] };
    const fetchMock = t.mock.method(globalThis, 'fetch', async function (input) {
        const url = new URL(input);
        if (url.pathname === '/metadata') {
            return Response.json(url.searchParams.get('type') === 'geo' ? geo : period);
        }
        if (url.pathname.startsWith('/cities/')) {
            return Response.json({
                hamburg: { name: 'Hamburg', population: 1800000, lat: 53.55, lon: 9.99 }
            });
        }
        if (url.pathname === '/composite') return new Response(tile);
        if (url.pathname.startsWith('/geo-overlay/')) return new Response(null, { status: 404 });
        throw new Error('Unexpected provider request: ' + url);
    });
    await import('./main.js');

    async function request(query = '') {
        const response = {};
        await handler({ method: 'GET', url: '/forecast' + query, headers: {} }, {
            writeHead(status, headers) {
                response.status = status;
                response.headers = headers;
            },
            end(data) { response.data = data; }
        });
        return response;
    }

    for (const label of ['', '2', '-1', 'true', '01']) {
        const invalid = await request('?label=' + label);
        assert.equal(invalid.status, 400);
        assert.equal(invalid.data, 'label must be 0 or 1');
    }
    assert.equal(fetchMock.mock.callCount(), 0);

    const unlabeled = await request();
    assert.equal(unlabeled.status, 200);
    assert.equal(unlabeled.headers['X-Forecast-Label'], '0');
    assert.equal(fetchMock.mock.calls.some(call => String(call.arguments[0]).includes('/cities/')), false);
    const callsBeforeCached = fetchMock.mock.callCount();
    const disabled = await request('?label=0');
    assert.deepEqual(disabled.data, unlabeled.data);
    assert.equal(fetchMock.mock.callCount(), callsBeforeCached);

    const labeled = await request('?label=1');
    assert.equal(labeled.status, 200);
    assert.equal(labeled.headers['X-Forecast-Label'], '1');
    assert.equal(fetchMock.mock.calls.filter(call => String(call.arguments[0]).includes('/cities/')).length, 1);
    const metadata = await sharp(labeled.data, { animated: true }).metadata();
    assert.equal(metadata.width, 512);
    assert.equal(metadata.pageHeight, 512);
    assert.equal(metadata.pages, 91);
    assert.ok(metadata.delay.every(delay => delay === 100));

    async function region(data, left, top, width, height) {
        return sharp(data).extract({ left, top, width, height }).ensureAlpha().raw().toBuffer();
    }
    assert.notDeepEqual(
        await region(labeled.data, 200, 240, 112, 32),
        await region(unlabeled.data, 200, 240, 112, 32)
    );
    assert.deepEqual(
        await region(labeled.data, 0, 0, 100, 100),
        await region(unlabeled.data, 0, 0, 100, 100)
    );
    const labeledTime = await region(labeled.data, 0, 452, 512, 60);
    const unlabeledTime = await region(unlabeled.data, 0, 452, 512, 60);
    // The additional text changes GIF palette quantization slightly.
    const meanTimeDifference = labeledTime.reduce((sum, value, index) =>
        sum + Math.abs(value - unlabeledTime[index]), 0) / labeledTime.length;
    assert.ok(meanTimeDifference < 1, 'time box must remain unchanged apart from GIF quantization');
    assert.deepEqual((await request()).data, unlabeled.data);

    for (const av1 of ['', 'yes', '2']) {
        const invalid = await request('?av1=' + av1);
        assert.equal(invalid.status, 400);
        assert.equal(invalid.data, 'av1 must be true or false');
    }
    assert.deepEqual((await request('?av1=false')).data, unlabeled.data);
    const video = await request('?av1=true');
    assert.equal(video.status, 200);
    assert.equal(video.headers['Content-Type'], 'video/mp4');
    assert.equal(video.headers['X-Forecast-Av1'], 'true');
    assert.equal(video.headers['X-Forecast-Frame-Delay-Ms'], '100');
    assert.equal(video.headers['Content-Length'], video.data.length);
    assert.equal(video.data.subarray(4, 8).toString('ascii'), 'ftyp');
    assert.notEqual(video.headers.ETag, unlabeled.headers.ETag);
    assert.deepEqual((await request('?av1=1')).data, video.data);

    const { execFileSync } = await import('node:child_process');
    const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const directory = mkdtempSync(tmpdir() + '/forecast-av1-test-');
    try {
        writeFileSync(directory + '/forecast.mp4', video.data);
        const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0',
            '-show_entries', 'stream=codec_name,width,height,nb_read_frames,r_frame_rate', '-of', 'json',
            directory + '/forecast.mp4']).toString()).streams[0];
        assert.deepEqual(probe, {
            codec_name: 'av1', width: 512, height: 512, r_frame_rate: '10/1', nb_read_frames: '91'
        });
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
});
