import http from 'http';
import { createHash } from 'node:crypto';
import cvModule from '@techstark/opencv-js';
import sharp from 'sharp';

const PORT = Number(process.env.PORT || 3000);
const FORECAST_STEP_SECONDS = 5 * 60;
const FORECAST_HORIZON_SECONDS = 90 * 60;
const FORECAST_FRAME_DELAY_MS = 500;
const FORECAST_CACHE_GRACE_MS = 30000;
const MAX_FORECAST_ZOOM = 100;
const HAMBURG = { latitude: 53.55, longitude: 9.99 };

function parseForecastFrameTime(id) {
    const match = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})-/.exec(id);
    if (!match) return NaN;
    return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]),
        Number(match[4]), Number(match[5])) / 1000;
}

function projectMercator(latitude, longitude, zoom) {
    const maxLatitude = 85.0511287798;
    const clampedLatitude = Math.max(-maxLatitude, Math.min(maxLatitude, latitude));
    const latitudeRadians = clampedLatitude * Math.PI / 180;
    const worldSize = 256 * Math.pow(2, zoom);
    const mercatorY = Math.log((1 + Math.sin(latitudeRadians)) /
        (1 - Math.sin(latitudeRadians)));
    return {
        x: (longitude + 180) / 360 * worldSize,
        y: (0.5 - mercatorY / (4 * Math.PI)) * worldSize
    };
}

function escapeXml(value) {
    return String(value).replace(/[&<>"']/g, function (character) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[character];
    });
}

function buildCityOverlaySvg(cities, zoom, center) {
    const topLeft = { x: center.x - 256, y: center.y - 256 };
    const labels = Object.values(cities || {}).filter(function (city) {
        return city.name && Number(city.population) >= 25000;
    }).map(function (city) {
        const point = projectMercator(Number(city.lat), Number(city.lon), zoom);
        return {
            name: city.name,
            population: Number(city.population),
            x: point.x - topLeft.x,
            y: point.y - topLeft.y
        };
    }).filter(function (city) {
        return city.x >= 4 && city.x <= 508 && city.y >= 10 && city.y <= 502;
    }).sort(function (left, right) {
        return right.population - left.population;
    }).slice(0, 30);

    const text = labels.map(function (city) {
        return '<text x="' + city.x.toFixed(1) + '" y="' + city.y.toFixed(1) +
            '" text-anchor="middle" dominant-baseline="central" font-family="Arial,sans-serif"' +
            ' font-size="12" fill="#172229" stroke="#fff" stroke-width="3"' +
            ' stroke-linejoin="round" paint-order="stroke">' + escapeXml(city.name) + '</text>';
    }).join('');

    return Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">' + text + '</svg>');
}

function buildTimeOverlaySvg(timestamp) {
    const time = new Intl.DateTimeFormat('de-DE', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Europe/Berlin'
    }).format(new Date(timestamp * 1000));
    return Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">' +
        '<rect x="0" y="392" width="512" height="120" fill="#fff" fill-opacity="0.7"/>' +
        '<text x="256" y="452" text-anchor="middle" dominant-baseline="central"' +
        ' font-family="monospace" font-size="100" font-weight="600" fill="#172a35">' +
        time + '</text></svg>');
}

function providerPath(...parts) {
    return parts.join('/').replace(/\/+/g, '/').replace(/^\/|\/$/g, '');
}

function buildCompositeTileUrl(frame, geo, zoom, tileX, tileY, options) {
    const includeBase = options.includeBase;
    const includeRain = options.includeRain;
    const seamask = geo.staticLayer.lsmTopography;
    const topography = geo.staticLayer.rrTopography;
    const topographyIndex = Math.max(0, Math.min(zoom - geo.minZoom, topography.type.length - 1));
    const baseX = tileX * 2;
    const baseY = tileY * 2;
    const baseTile = 'ZL' + zoom + '/512/' + baseX + '_' + baseY;
    const seamaskPath = providerPath(geo.staticLayer.path, seamask.path, baseTile + '.png');
    const topographyPath = providerPath(geo.staticLayer.path, topography.path,
        baseTile + '.' + (topography.type[topographyIndex] || 'jpg'));
    const europeRain = frame && frame.layers.europe && frame.layers.europe.rain;
    const globalRain = frame && frame.layers.global && frame.layers.global.rain;
    const rainZoom = Math.min(zoom, (europeRain && europeRain.mnz) || 7);
    const rainScale = Math.pow(2, zoom - rainZoom);
    const rainBaseX = Math.floor(tileX / rainScale) * 2;
    const rainBaseY = Math.floor(tileY / rainScale) * 2;
    const rainOffsetX = tileX - Math.floor(tileX / rainScale) * rainScale;
    const rainOffsetY = tileY - Math.floor(tileY / rainScale) * rainScale;

    function rainPath(layer, kind) {
        if (!layer) return '';
        return providerPath(layer.ptypPath, layer.path, layer.timePath.join('/'),
            'ZL' + rainZoom + '/522/' + kind + '/' + rainBaseX + '_' + rainBaseY + '.png');
    }

    const rainPaths = [rainPath(europeRain, 'sprite'), rainPath(globalRain, 'border')]
        .filter(Boolean).join(';');
    const layers = [];
    if (includeBase) {
        layers.push('seamask|1;;0;0|' + seamaskPath);
        layers.push('topo|1;;0;0|' + topographyPath);
    }
    if (includeRain && rainPaths) {
        layers.push('r|' + rainScale + ';;' + rainOffsetX + ';' + rainOffsetY + ';false|' + rainPaths);
    }
    const url = new URL('https://tiles.wo-cloud.com/composite');
    url.searchParams.set('format', 'webp');
    url.searchParams.set('lg', 'rr');
    url.searchParams.set('tiles', Buffer.from(layers.join('$')).toString('base64'));
    if (frame) url.searchParams.set('time', frame.id);
    return url;
}

function buildGeoOverlayUrl(geo, zoom, tileX, tileY) {
    const version = geo.staticLayer.rrGeooverlay.currentVersion;
    const tilePath = 'ZL' + zoom + '/512/' + (tileX * 2) + '_' + (tileY * 2) + '.svg';
    return 'https://radar.wo-cloud.com/geo-overlay/rr_geooverlay/' + version + '/' + tilePath;
}

async function fetchProviderBuffer(url, allowMissing) {
    const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (allowMissing && response.status === 404) return null;
    if (!response.ok) throw new Error('WetterOnline returned HTTP ' + response.status);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (allowMissing && buffer.length === 0) return null;
    return buffer;
}

async function mapWithConcurrency(items, concurrency, task) {
    const results = new Array(items.length);
    let nextIndex = 0;
    const workerCount = Math.min(concurrency, items.length);
    await Promise.all(Array.from({ length: workerCount }, async function () {
        while (nextIndex < items.length) {
            const index = nextIndex++;
            results[index] = await task(items[index], index);
        }
    }));
    return results;
}

let openCvPromise;

function loadOpenCv() {
    if (!openCvPromise) {
        openCvPromise = Promise.resolve(cvModule).then(async function (module) {
            let cv = module && module.default ? module.default : module;
            if (cv instanceof Promise) cv = await cv;
            if (!cv.Mat) {
                await new Promise(function (resolve) { cv.onRuntimeInitialized = resolve; });
            }
            return cv;
        });
    }
    return openCvPromise;
}

async function estimateRainFlow(cv, sourceBuffer, targetBuffer) {
    if (sourceBuffer.length !== 512 * 512 * 4 || targetBuffer.length !== 512 * 512 * 4) {
        throw new Error('Optical-flow frames must be 512x512 RGBA buffers');
    }
    const sourceGray = Buffer.alloc(512 * 512);
    const targetGray = Buffer.alloc(512 * 512);
    for (let pixel = 0; pixel < sourceGray.length; pixel += 1) {
        const offset = pixel * 4;
        sourceGray[pixel] = sourceBuffer[offset + 3] === 0 ? 0 :
            255 - Math.min(sourceBuffer[offset], sourceBuffer[offset + 1], sourceBuffer[offset + 2]);
        targetGray[pixel] = targetBuffer[offset + 3] === 0 ? 0 :
            255 - Math.min(targetBuffer[offset], targetBuffer[offset + 1], targetBuffer[offset + 2]);
    }

    const sourceMat = new cv.Mat(512, 512, cv.CV_8UC1);
    const targetMat = new cv.Mat(512, 512, cv.CV_8UC1);
    const flowMat = new cv.Mat();
    try {
        sourceMat.data.set(sourceGray);
        targetMat.data.set(targetGray);
        cv.calcOpticalFlowFarneback(sourceMat, targetMat, flowMat, 0.5, 4, 21, 4, 5, 1.2, 0);
        return Float32Array.from(flowMat.data32F);
    } finally {
        sourceMat.delete();
        targetMat.delete();
        flowMat.delete();
    }
}

function advectRainImage(source, flow, fraction) {
    const pixelCount = 512 * 512;
    const output = Buffer.alloc(pixelCount * 4);

    function sampleField(x, y, channel) {
        const left = Math.max(0, Math.min(511, Math.floor(x)));
        const top = Math.max(0, Math.min(511, Math.floor(y)));
        const right = Math.min(511, left + 1);
        const bottom = Math.min(511, top + 1);
        const dx = Math.max(0, Math.min(1, x - left));
        const dy = Math.max(0, Math.min(1, y - top));
        const upper = flow[(top * 512 + left) * 2 + channel] * (1 - dx) +
            flow[(top * 512 + right) * 2 + channel] * dx;
        const lower = flow[(bottom * 512 + left) * 2 + channel] * (1 - dx) +
            flow[(bottom * 512 + right) * 2 + channel] * dx;
        return upper * (1 - dy) + lower * dy;
    }

    function sampleColor(x, y, channel) {
        const left = Math.max(0, Math.min(511, Math.floor(x)));
        const top = Math.max(0, Math.min(511, Math.floor(y)));
        const right = Math.min(511, left + 1);
        const bottom = Math.min(511, top + 1);
        const dx = Math.max(0, Math.min(1, x - left));
        const dy = Math.max(0, Math.min(1, y - top));
        const upper = source[(top * 512 + left) * 4 + channel] * (1 - dx) +
            source[(top * 512 + right) * 4 + channel] * dx;
        const lower = source[(bottom * 512 + left) * 4 + channel] * (1 - dx) +
            source[(bottom * 512 + right) * 4 + channel] * dx;
        return Math.round(upper * (1 - dy) + lower * dy);
    }

    for (let y = 0; y < 512; y += 1) {
        for (let x = 0; x < 512; x += 1) {
            let sourceX = x;
            let sourceY = y;
            for (let iteration = 0; iteration < 3; iteration += 1) {
                sourceX = x - sampleField(sourceX, sourceY, 0) * fraction;
                sourceY = y - sampleField(sourceX, sourceY, 1) * fraction;
            }
            const outputOffset = (y * 512 + x) * 4;
            for (let channel = 0; channel < 4; channel += 1) {
                output[outputOffset + channel] = sampleColor(sourceX, sourceY, channel);
            }
        }
    }
    return output;
}

async function renderHamburgFrame(frame, geo, zoom, center, geoTileCache, layerMode) {
    const firstTileX = Math.floor((center.x - 256) / 512);
    const firstTileY = Math.floor((center.y - 256) / 512);
    const cropLeft = Math.round(center.x - firstTileX * 512 - 256);
    const cropTop = Math.round(center.y - firstTileY * 512 - 256);
    const positions = [];

    for (let row = 0; row < 2; row += 1) {
        for (let column = 0; column < 2; column += 1) {
            positions.push({
                x: firstTileX + column,
                y: firstTileY + row,
                left: column * 512,
                top: row * 512
            });
        }
    }

    const blankTile = await sharp({
        create: { width: 512, height: 512, channels: 4,
            background: layerMode === 'rain' ? { r: 0, g: 0, b: 0, alpha: 0 } : '#fff' }
    }).png().toBuffer();
    const fetchedTiles = await Promise.all(positions.map(async function (position) {
        const geoKey = position.x + ':' + position.y;
        if (layerMode === 'base' && !geoTileCache.has(geoKey)) {
            geoTileCache.set(geoKey, fetchProviderBuffer(
                buildGeoOverlayUrl(geo, zoom, position.x, position.y), true
            ));
        }

        const [mapTile, geoTile] = await Promise.all([
            fetchProviderBuffer(buildCompositeTileUrl(
                layerMode === 'rain' ? frame : null,
                geo,
                zoom,
                position.x,
                position.y,
                { includeBase: layerMode === 'base', includeRain: layerMode === 'rain' }
            ), true),
            layerMode === 'base' ? geoTileCache.get(geoKey) : null
        ]);
        return { position: position, mapTile: mapTile, geoTile: geoTile };
    }));

    if (layerMode === 'base') {
        const hasVisibleBasemap = await Promise.all(fetchedTiles.map(async function (tile) {
            if (!tile.mapTile) return false;
            const stats = await sharp(tile.mapTile).stats();
            return stats.channels.slice(0, 3).some(function (channel) {
                return channel.min < 245 || channel.max < 250;
            });
        })).then(function (results) { return results.some(Boolean); });
        if (!hasVisibleBasemap) {
            const error = new Error('WetterOnline returned no basemap tiles; x is longitude and y is latitude.');
            error.statusCode = 422;
            throw error;
        }
    }

    const mapLayers = [];
    const geoLayers = [];
    for (const tile of fetchedTiles) {
        mapLayers.push({
            input: tile.mapTile || blankTile,
            left: tile.position.left,
            top: tile.position.top
        });
        if (tile.geoTile) {
            geoLayers.push({
                input: await sharp(tile.geoTile).resize(512, 512, { fit: 'fill' }).png().toBuffer(),
                left: tile.position.left,
                top: tile.position.top
            });
        }
    }

    const mosaic = await sharp({
        create: { width: 1024, height: 1024, channels: 4,
            background: layerMode === 'rain' ? { r: 0, g: 0, b: 0, alpha: 0 } : '#fff' }
    }).composite(mapLayers.concat(geoLayers)).png().toBuffer();

    const cropped = await sharp(mosaic)
        .extract({ left: cropLeft, top: cropTop, width: 512, height: 512 })
        .png()
        .toBuffer();
    return cropped;
}

async function generateForecastGif(location) {
    const metadataUrls = [
        'https://tiles.wo-cloud.com/metadata?type=geo',
        'https://tiles.wo-cloud.com/metadata?lg=wr&period=periodCurrentHighRes&type=period',
        'https://tiles.wo-cloud.com/metadata?lg=wr&period=periodCurrentLowRes&type=period',
        'https://radar.wo-cloud.com/cities/v29/cities/de.json'
    ];
    const metadataResponses = await Promise.all(metadataUrls.map(function (url) {
        return fetch(url, { signal: AbortSignal.timeout(20000) });
    }));
    const failedResponse = metadataResponses.slice(0, 3).find(function (response) { return !response.ok; });
    if (failedResponse) throw new Error('Forecast metadata returned HTTP ' + failedResponse.status);
    const [geo, highResolution, lowResolution, cities] = await Promise.all(metadataResponses.map(function (response, index) {
        if (index === 3 && !response.ok) return {};
        return response.json();
    }));
    const zoom = location.zoom === undefined ? Number(geo.maxZoom) : location.zoom;
    if (zoom < Number(geo.minZoom) || zoom > MAX_FORECAST_ZOOM) {
        const error = new RangeError('Zoom must be between ' + geo.minZoom + ' and ' + MAX_FORECAST_ZOOM);
        error.statusCode = 400;
        throw error;
    }
    const sourceZoom = Math.min(zoom, Number(geo.maxZoom));
    const overzoomScale = zoom > sourceZoom ? zoom / sourceZoom : 1;
    const highStep = Number(geo.timeRangeConfig.periodCurrentHighRes.timeResolution[sourceZoom] || 5);
    const lowStep = Number(geo.timeRangeConfig.periodCurrentLowRes.timeResolution[sourceZoom] || 15);
    const now = Date.now() / 1000;
    const startTime = Math.ceil(now / FORECAST_STEP_SECONDS) * FORECAST_STEP_SECONDS;
    const candidates = new Map();

    [
        { period: highResolution, resolution: highStep },
        { period: lowResolution, resolution: lowStep }
    ].forEach(function (source) {
        source.period.timesteps.forEach(function (frame) {
            const time = parseForecastFrameTime(frame.id);
            if (!Number.isFinite(time)) return;
            if (Array.isArray(frame.available) && frame.available.indexOf(source.resolution) === -1) return;
            const existing = candidates.get(frame.id);
            if (!existing || source.resolution < existing.resolution) {
                candidates.set(frame.id, {
                    id: frame.id,
                    time: time,
                    resolution: source.resolution,
                    layers: frame.layers
                });
            }
        });
    });

    const availableFrames = Array.from(candidates.values()).sort(function (left, right) {
        return left.time - right.time;
    });
    const futureFrames = availableFrames.filter(function (frame) { return frame.time > now; });
    if (!futureFrames.length) throw new Error('WetterOnline has no future forecast frames');

    const steps = Array.from({ length: FORECAST_HORIZON_SECONDS / FORECAST_STEP_SECONDS + 1 },
        function (_, index) {
            const time = startTime + index * FORECAST_STEP_SECONDS;
            const nextIndex = availableFrames.findIndex(function (frame) { return frame.time >= time; });
            if (nextIndex === -1) {
                const after = availableFrames[availableFrames.length - 1];
                const before = availableFrames[availableFrames.length - 2] || after;
                const interval = Math.max(FORECAST_STEP_SECONDS, after.time - before.time);
                const amount = before === after ? 1 : 1 + (time - after.time) / interval;
                return { time: time, before: before, after: after, amount: amount, extrapolate: before !== after };
            }

            const after = availableFrames[nextIndex];
            const before = after.time === time || nextIndex === 0 ? after : availableFrames[nextIndex - 1];
            const amount = after.time === before.time ? 0 :
                Math.max(0, Math.min(1, (time - before.time) / (after.time - before.time)));
            return { time: time, before: before, after: after, amount: amount };
        });

    const sourceFrames = new Map();
    steps.forEach(function (step) {
        sourceFrames.set(step.before.id, step.before);
        sourceFrames.set(step.after.id, step.after);
    });
    const uniqueFrames = Array.from(sourceFrames.values());
    const center = projectMercator(location.y, location.x, sourceZoom);
    const cityOverlay = buildCityOverlaySvg(cities, sourceZoom, center);
    const geoTileCache = new Map();
    const [baseImage, renderedRainFrames] = await Promise.all([
        renderHamburgFrame(null, geo, sourceZoom, center, geoTileCache, 'base'),
        mapWithConcurrency(uniqueFrames, 3, async function (frame) {
            return {
                id: frame.id,
                image: await renderHamburgFrame(frame, geo, sourceZoom, center, new Map(), 'rain')
            };
        })
    ]);
    const rainImageById = new Map(renderedRainFrames.map(function (frame) { return [frame.id, frame.image]; }));
    const rawRainById = new Map();
    const flowByPair = new Map();
    const cv = await loadOpenCv();

    function getRawRain(frame) {
        if (!rawRainById.has(frame.id)) {
            rawRainById.set(frame.id, sharp(rainImageById.get(frame.id))
                .ensureAlpha()
                .raw()
                .toBuffer({ resolveWithObject: true }));
        }
        return rawRainById.get(frame.id);
    }

    function getFlow(sourceFrame, targetFrame) {
        const key = sourceFrame.id + '>' + targetFrame.id;
        if (!flowByPair.has(key)) {
            flowByPair.set(key, Promise.all([getRawRain(sourceFrame), getRawRain(targetFrame)])
                .then(function (images) { return estimateRainFlow(cv, images[0].data, images[1].data); }));
        }
        return flowByPair.get(key);
    }

    const images = await mapWithConcurrency(steps, 3, async function (step) {
        let rainImage = rainImageById.get(step.before.id);
        if (step.before.id !== step.after.id && step.amount > 0) {
            const useAfter = step.amount > 0.5;
            const sourceFrame = step.extrapolate ? step.after :
                (useAfter ? step.after : step.before);
            const flowSource = step.extrapolate ? step.before : sourceFrame;
            const flowTarget = step.extrapolate ? step.after :
                (useAfter ? step.before : step.after);
            const fraction = step.extrapolate ? step.amount - 1 :
                (useAfter ? 1 - step.amount : step.amount);
            const [source, flow] = await Promise.all([
                getRawRain(sourceFrame),
                getFlow(flowSource, flowTarget)
            ]);
            const advected = advectRainImage(source.data, flow, fraction);
            rainImage = await sharp(advected, {
                raw: { width: 512, height: 512, channels: 4 }
            }).png().toBuffer();
        }

        const mapFrame = await sharp(baseImage).composite([
            { input: rainImage },
            { input: cityOverlay }
        ]).png().toBuffer();
        let centeredFrame = mapFrame;
        if (overzoomScale > 1) {
            const cropSize = Math.max(1, Math.round(512 / overzoomScale));
            const cropStart = Math.floor((512 - cropSize) / 2);
            centeredFrame = await sharp(mapFrame)
                .extract({ left: cropStart, top: cropStart, width: cropSize, height: cropSize })
                .resize(512, 512, { fit: 'fill' })
                .png()
                .toBuffer();
        }
        return sharp(centeredFrame).composite([{ input: buildTimeOverlaySvg(step.time) }]).png().toBuffer();
    });
    const gif = await sharp(images, {
        join: { animated: true, across: 1, background: '#fff' }
    }).gif({
        loop: 0,
        delay: images.map(function () { return FORECAST_FRAME_DELAY_MS; }),
        keepDuplicateFrames: true,
        effort: 5
    }).toBuffer();

    return {
        data: gif,
        zoom: zoom,
        sourceZoom: sourceZoom,
        x: location.x,
        y: location.y,
        start: steps[0].time,
        end: steps[steps.length - 1].time,
        frames: steps.length
    };
}

const FORECAST_CACHE_MAX_ENTRIES = 8;
const forecastCache = new Map();
const forecastGeneration = new Map();

function getCachedForecastGif(location) {
    const cacheKey = [location.x.toFixed(6), location.y.toFixed(6),
        location.zoom === undefined ? 'max' : String(location.zoom)].join(':');
    const cached = forecastCache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
        forecastCache.delete(cacheKey);
        forecastCache.set(cacheKey, cached);
        return Promise.resolve(cached);
    }
    forecastCache.delete(cacheKey);

    let generation = forecastGeneration.get(cacheKey);
    if (!generation) {
        generation = generateForecastGif(location).then(function (result) {
            const intervalMilliseconds = FORECAST_STEP_SECONDS * 1000;
            const nextBoundary = (Math.floor(result.start * 1000 / intervalMilliseconds) + 1) * intervalMilliseconds;
            const entry = {
                ...result,
                expiresAt: nextBoundary + FORECAST_CACHE_GRACE_MS,
                etag: '"' + createHash('sha256').update(result.data).digest('hex') + '"'
            };
            forecastCache.set(cacheKey, entry);
            while (forecastCache.size > FORECAST_CACHE_MAX_ENTRIES) {
                forecastCache.delete(forecastCache.keys().next().value);
            }
            return entry;
        }).finally(function () {
            forecastGeneration.delete(cacheKey);
        });
        forecastGeneration.set(cacheKey, generation);
    }
    return generation;
}

function forecastResponseHeaders(result) {
    const maxAge = Math.max(0, Math.floor((result.expiresAt - Date.now()) / 1000));
    return {
        'Content-Type': 'image/gif',
        'Content-Length': result.data.length,
        'Cache-Control': 'public, max-age=' + maxAge + ', must-revalidate',
        'Expires': new Date(result.expiresAt).toUTCString(),
        'ETag': result.etag,
        'X-Forecast-Zoom': String(result.zoom),
        'X-Forecast-Source-Zoom': String(result.sourceZoom),
        'X-Forecast-X': String(result.x),
        'X-Forecast-Y': String(result.y),
        'X-Forecast-Frames': String(result.frames),
        'X-Forecast-Start': new Date(result.start * 1000).toISOString(),
        'X-Forecast-End': new Date(result.end * 1000).toISOString(),
        'X-Forecast-Cache-Until': new Date(result.expiresAt).toISOString(),
        'X-Forecast-Source': 'WetterOnline RegenRadar'
    };
}

const server = http.createServer(async (req, res) => {
    if (req.url === '/healthz') {
        res.writeHead(200);
        res.end('OK');
        return;
    }

    const requestUrl = new URL(req.url, 'http://localhost');
    if (requestUrl.pathname === '/forecast') {
        if (req.method !== 'GET') {
            res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8', 'Allow': 'GET' });
            res.end('Method not allowed');
            return;
        }

        try {
            const xParameter = requestUrl.searchParams.get('x');
            const yParameter = requestUrl.searchParams.get('y');
            const zoomParameter = requestUrl.searchParams.get('zoom');
            const location = {
                x: xParameter === null ? HAMBURG.longitude : Number(xParameter),
                y: yParameter === null ? HAMBURG.latitude : Number(yParameter),
                zoom: zoomParameter === null ? undefined : Number(zoomParameter)
            };

            if (!Number.isFinite(location.x) || location.x < -180 || location.x > 180 ||
                !Number.isFinite(location.y) || location.y < -90 || location.y > 90) {
                const error = new RangeError('x must be longitude (-180..180) and y latitude (-90..90)');
                error.statusCode = 400;
                throw error;
            }
            if (zoomParameter !== null && (!Number.isInteger(location.zoom) || location.zoom < 0 || location.zoom > MAX_FORECAST_ZOOM)) {
                const error = new RangeError('zoom must be an integer between 0 and ' + MAX_FORECAST_ZOOM);
                error.statusCode = 400;
                throw error;
            }

            const result = await getCachedForecastGif(location);
            const headers = forecastResponseHeaders(result);
            if (req.headers['if-none-match'] === result.etag) {
                res.writeHead(304, headers);
                res.end();
                return;
            }
            res.writeHead(200, headers);
            res.end(result.data);
        } catch (error) {
            console.error('Forecast GIF generation failed:', error);
            res.writeHead(error.statusCode || 502, {
                'Content-Type': 'text/plain; charset=utf-8',
                'Cache-Control': 'no-store'
            });
            res.end(error.statusCode ? error.message : 'WetterOnline forecast GIF generation failed');
        }
        return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
});

server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
