import assert from 'node:assert/strict';
import http from 'node:http';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import sharp from 'sharp';

test('forecast labels are opt-in in HTTP requests and rendered AV1 videos', async function (t) {
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

    assert.equal(unlabeled.headers['Content-Type'], 'video/mp4');
    assert.equal(unlabeled.headers['X-Forecast-Frames'], '91');
    assert.equal(unlabeled.headers['X-Forecast-Frame-Delay-Ms'], '100');
    assert.equal(unlabeled.headers['Content-Length'], unlabeled.data.length);
    assert.equal(unlabeled.data.subarray(4, 8).toString('ascii'), 'ftyp');
    // The av1 parameter from older clients is ignored.
    assert.deepEqual((await request('?av1=true')).data, unlabeled.data);

    const directory = mkdtempSync(tmpdir() + '/forecast-av1-test-');
    t.after(function () { rmSync(directory, { recursive: true, force: true }); });
    function firstFrame(name, data) {
        writeFileSync(directory + '/' + name + '.mp4', data);
        execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', directory + '/' + name + '.mp4',
            '-frames:v', '1', directory + '/' + name + '.png']);
        return directory + '/' + name + '.png';
    }
    const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0',
        '-show_entries', 'stream=codec_name,width,height,nb_read_frames,r_frame_rate', '-of', 'json',
        '-i', 'pipe:0'], { input: unlabeled.data }).toString()).streams[0];
    assert.deepEqual(probe, {
        codec_name: 'av1', width: 512, height: 512, r_frame_rate: '10/1', nb_read_frames: '91'
    });

    const labeledFrame = firstFrame('labeled', labeled.data);
    const unlabeledFrame = firstFrame('unlabeled', unlabeled.data);
    async function meanDifference(left, top, width, height) {
        const region = file => sharp(file).extract({ left, top, width, height }).removeAlpha().raw().toBuffer();
        const a = await region(labeledFrame);
        const b = await region(unlabeledFrame);
        return a.reduce((sum, value, index) => sum + Math.abs(value - b[index]), 0) / a.length;
    }
    // AV1 is lossy, so unchanged regions are compared with a small tolerance.
    assert.ok(await meanDifference(200, 240, 112, 32) > 5, 'label must be drawn');
    assert.ok(await meanDifference(0, 0, 100, 100) < 1, 'map away from the label must remain unchanged');
    assert.ok(await meanDifference(0, 452, 512, 60) < 1, 'time box must remain unchanged');
    assert.deepEqual((await request()).data, unlabeled.data);

    for (const noFooter of ['', '2', 'true']) {
        const invalid = await request('?noFooter=' + noFooter);
        assert.equal(invalid.status, 400);
        assert.equal(invalid.data, 'noFooter must be 0 or 1');
    }
    assert.deepEqual((await request('?noFooter=0')).data, unlabeled.data);
    const footerless = await request('?noFooter=1');
    assert.equal(footerless.status, 200);
    assert.equal(footerless.headers['X-Forecast-No-Footer'], '1');
    assert.equal(unlabeled.headers['X-Forecast-No-Footer'], '0');
    assert.equal(footerless.headers['X-Forecast-Frames'], '91');
    assert.equal(footerless.headers['X-Forecast-Start'], unlabeled.headers['X-Forecast-Start']);
    // Without the moving progress bar and clock, a static map compresses to almost nothing.
    assert.ok(footerless.data.length < unlabeled.data.length / 2,
        footerless.data.length + ' bytes must be well below ' + unlabeled.data.length);
    const footerlessFrame = await sharp(firstFrame('footerless', footerless.data))
        .extract({ left: 0, top: 452, width: 512, height: 60 }).removeAlpha().raw().toBuffer();
    const mapColour = await sharp(unlabeledFrame)
        .extract({ left: 0, top: 200, width: 512, height: 60 }).removeAlpha().raw().toBuffer();
    const footerDifference = footerlessFrame.reduce((sum, value, index) =>
        sum + Math.abs(value - mapColour[index]), 0) / footerlessFrame.length;
    assert.ok(footerDifference < 2, 'footer area must show the map, not the time box');
});
