import { spawn } from 'child_process';
import { mkdtemp, readFile, rm } from 'fs/promises';
import http from 'http';
import { tmpdir } from 'os';
import path from 'path';
import { createForecastCache, forecastResponseHeaders } from './forecast-cache.js';
import cvModule from '@techstark/opencv-js';
import sharp from 'sharp';

const PORT = Number(process.env.PORT || 3000);
const FORECAST_STEP_SECONDS = 5 * 60;
const FORECAST_FRAME_SECONDS = 60;
const FORECAST_HORIZON_SECONDS = 90 * 60;
const FORECAST_FRAME_DELAY_MS = 500 * FORECAST_FRAME_SECONDS / FORECAST_STEP_SECONDS;
const MAX_FORECAST_ZOOM = 100;
const FORECAST_THEMES = ['light', 'dark'];
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
            '" text-anchor="middle" dominant-baseline="central" font-family="Fira Sans,sans-serif"' +
            ' font-size="12" fill="#172229" stroke="#fff" stroke-width="3"' +
            ' stroke-linejoin="round" paint-order="stroke">' + escapeXml(city.name) + '</text>';
    }).join('');

    return Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">' + text + '</svg>');
}

function buildTimeOverlaySvg(timestamp, progress) {
    const time = new Intl.DateTimeFormat('de-DE', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Europe/Berlin'
    }).format(new Date(timestamp * 1000));
    const progressWidth = 512 * Math.max(0, Math.min(1, Number(progress) || 0));
    return Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">' +
        '<rect x="0" y="452" width="512" height="60" fill="#fff" fill-opacity="0.7"/>' +
        '<rect x="0" y="452" width="' + progressWidth.toFixed(1) + '" height="60"' +
        ' fill="#172a35" fill-opacity="0.3"/>' +
        '<text x="256" y="482" text-anchor="middle" dominant-baseline="central"' +
        ' font-family="Fira Sans,sans-serif" font-size="50" font-weight="600" fill="#172a35">' +
        time + '</text></svg>');
}

function providerPath(...parts) {
    return parts.join('/').replace(/\/+/g, '/').replace(/^\/|\/$/g, '');
}

function tileIntersectsEurope(geo, zoom, tileX, tileY) {
    const bounds = geo.subAreas && geo.subAreas.europe && geo.subAreas.europe.bounds;
    if (!bounds) return true;
    const north = Math.max(bounds[0][0], bounds[1][0]);
    const south = Math.min(bounds[0][0], bounds[1][0]);
    const west = Math.min(bounds[0][1], bounds[1][1]);
    const east = Math.max(bounds[0][1], bounds[1][1]);
    const tiles = Math.pow(2, zoom - 1);
    const tileWest = tileX / tiles * 360 - 180;
    const tileEast = (tileX + 1) / tiles * 360 - 180;
    function latitude(y) {
        return Math.atan(Math.sinh(Math.PI * (1 - 2 * y / tiles))) * 180 / Math.PI;
    }
    const tileNorth = latitude(tileY);
    const tileSouth = latitude(tileY + 1);
    return tileEast > west && tileWest < east && tileNorth > south && tileSouth < north;
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
    // Europe radar only covers its sub-area; elsewhere WetterOnline draws the global sprite at its own zoom.
    const outsideEurope = !tileIntersectsEurope(geo, zoom, tileX, tileY);
    const rainZoom = Math.min(zoom, (outsideEurope ? globalRain && globalRain.mnz :
        europeRain && europeRain.mnz) || 7);
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

    const rainPaths = (outsideEurope ? [rainPath(globalRain, 'sprite')] :
        [rainPath(europeRain, 'sprite'), rainPath(globalRain, 'border')])
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
        // A Gaussian window tracks moving rain cells more closely than the default box filter.
        cv.calcOpticalFlowFarneback(sourceMat, targetMat, flowMat, 0.5, 5, 41, 6, 7, 1.5,
            cv.OPTFLOW_FARNEBACK_GAUSSIAN);
        return Float32Array.from(flowMat.data32F);
    } finally {
        sourceMat.delete();
        targetMat.delete();
        flowMat.delete();
    }
}

const RAIN_DISTANCE_LIMIT = 24;

function sampleBilinear(field, stride, channel, x, y) {
    const left = Math.max(0, Math.min(511, Math.floor(x)));
    const top = Math.max(0, Math.min(511, Math.floor(y)));
    const right = Math.min(511, left + 1);
    const bottom = Math.min(511, top + 1);
    const dx = Math.max(0, Math.min(1, x - left));
    const dy = Math.max(0, Math.min(1, y - top));
    const upper = field[(top * 512 + left) * stride + channel] * (1 - dx) +
        field[(top * 512 + right) * stride + channel] * dx;
    const lower = field[(bottom * 512 + left) * stride + channel] * (1 - dx) +
        field[(bottom * 512 + right) * stride + channel] * dx;
    return upper * (1 - dy) + lower * dy;
}

// For each output pixel, find where it came from when moving `fraction` of the way along `flow`.
function computeSourcePositions(flow, fraction) {
    const positions = new Float32Array(512 * 512 * 2);
    for (let y = 0; y < 512; y += 1) {
        for (let x = 0; x < 512; x += 1) {
            let sourceX = x;
            let sourceY = y;
            for (let iteration = 0; iteration < 3; iteration += 1) {
                sourceX = x - sampleBilinear(flow, 2, 0, sourceX, sourceY) * fraction;
                sourceY = y - sampleBilinear(flow, 2, 1, sourceX, sourceY) * fraction;
            }
            positions[(y * 512 + x) * 2] = sourceX;
            positions[(y * 512 + x) * 2 + 1] = sourceY;
        }
    }
    return positions;
}

// Radar imagery uses a few flat colour bands; noisy near-duplicates and anti-aliased edges are
// ignored by only counting pixels whose four neighbours share the exact same colour.
function buildRainPalette(images) {
    const counts = new Map();
    for (const image of images) {
        for (let y = 1; y < 511; y += 1) {
            for (let x = 1; x < 511; x += 1) {
                const offset = (y * 512 + x) * 4;
                if (image[offset + 3] < 128) continue;
                const color = image.readUInt32BE(offset);
                if (image.readUInt32BE(offset - 4) !== color || image.readUInt32BE(offset + 4) !== color ||
                    image.readUInt32BE(offset - 2048) !== color || image.readUInt32BE(offset + 2048) !== color) {
                    continue;
                }
                counts.set(color, (counts.get(color) || 0) + 1);
            }
        }
    }
    const palette = [];
    Array.from(counts.entries()).sort(function (left, right) { return right[1] - left[1]; })
        .forEach(function (entry) {
            if (entry[1] < 16 || palette.length >= 32) return;
            const color = [entry[0] >>> 24, (entry[0] >>> 16) & 255, (entry[0] >>> 8) & 255, entry[0] & 255];
            const isDuplicate = palette.some(function (existing) {
                return Math.hypot(existing[0] - color[0], existing[1] - color[1], existing[2] - color[2]) < 16;
            });
            if (!isDuplicate) palette.push(color);
        });
    return palette;
}

function labelRainImage(image, palette) {
    const labels = new Uint8Array(512 * 512);
    if (!palette.length) return labels;
    for (let pixel = 0; pixel < labels.length; pixel += 1) {
        const offset = pixel * 4;
        if (image[offset + 3] < 128) continue;
        let best = 0;
        let bestDistance = Infinity;
        for (let index = 0; index < palette.length; index += 1) {
            const distance = (image[offset] - palette[index][0]) ** 2 +
                (image[offset + 1] - palette[index][1]) ** 2 +
                (image[offset + 2] - palette[index][2]) ** 2;
            if (distance < bestDistance) {
                bestDistance = distance;
                best = index;
            }
        }
        labels[pixel] = best + 1;
    }
    return labels;
}

// Signed distance (negative inside) to each colour band's region, clamped so that new cells grow
// from nearby rather than popping in at the very end of an interval.
function computeRainDistanceFields(cv, labels, labelCount) {
    const fields = new Array(labelCount).fill(null);
    const mask = new cv.Mat(512, 512, cv.CV_8UC1);
    const inverse = new cv.Mat(512, 512, cv.CV_8UC1);
    const inside = new cv.Mat();
    const outside = new cv.Mat();
    try {
        for (let label = 0; label < labelCount; label += 1) {
            let present = false;
            for (let pixel = 0; pixel < labels.length; pixel += 1) {
                const isLabel = labels[pixel] === label;
                mask.data[pixel] = isLabel ? 255 : 0;
                inverse.data[pixel] = isLabel ? 0 : 255;
                present = present || isLabel;
            }
            if (!present) continue;
            cv.distanceTransform(mask, inside, cv.DIST_L2, 5);
            cv.distanceTransform(inverse, outside, cv.DIST_L2, 5);
            const field = new Float32Array(labels.length);
            for (let pixel = 0; pixel < labels.length; pixel += 1) {
                const distance = labels[pixel] === label ?
                    0.5 - inside.data32F[pixel] : outside.data32F[pixel] - 0.5;
                field[pixel] = Math.max(-RAIN_DISTANCE_LIMIT, Math.min(RAIN_DISTANCE_LIMIT, distance));
            }
            fields[label] = field;
        }
    } finally {
        mask.delete();
        inverse.delete();
        outside.delete();
        inside.delete();
    }
    return fields;
}

// Moves each source's colour-band regions along its flow, interpolates their boundaries, and paints
// every pixel with the band it lies deepest inside. Regions only move, grow, or shrink.
function renderMorphedRain(sources, palette) {
    const colors = [[0, 0, 0, 0]].concat(palette);
    const activeLabels = colors.map(function (_, label) { return label; }).filter(function (label) {
        return label === 0 || sources.some(function (source) { return source.fields[label]; });
    });
    const output = Buffer.alloc(512 * 512 * 4);
    for (let pixel = 0; pixel < 512 * 512; pixel += 1) {
        let best = 0;
        let bestDistance = Infinity;
        let second = 0;
        let secondDistance = Infinity;
        for (const label of activeLabels) {
            let distance = 0;
            for (const source of sources) {
                const field = source.fields[label];
                let value = RAIN_DISTANCE_LIMIT;
                if (field) {
                    value = source.positions ?
                        sampleBilinear(field, 1, 0, source.positions[pixel * 2], source.positions[pixel * 2 + 1]) :
                        field[pixel];
                }
                distance += value * source.weight;
            }
            if (distance < bestDistance) {
                second = best;
                secondDistance = bestDistance;
                best = label;
                bestDistance = distance;
            } else if (distance < secondDistance) {
                second = label;
                secondDistance = distance;
            }
        }
        // Anti-alias only where two bands meet within a pixel.
        const coverage = Math.max(0.5, Math.min(1, 0.5 + (secondDistance - bestDistance) / 2));
        const first = colors[best];
        const other = colors[second];
        const firstAlpha = first[3] * coverage;
        const otherAlpha = other[3] * (1 - coverage);
        const alpha = firstAlpha + otherAlpha;
        const offset = pixel * 4;
        if (alpha === 0) continue;
        for (let channel = 0; channel < 3; channel += 1) {
            output[offset + channel] = Math.round((first[channel] * firstAlpha + other[channel] * otherAlpha) / alpha);
        }
        output[offset + 3] = Math.round(alpha);
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

async function generateForecastVideo(location) {
    const renderStartedAt = Date.now();
    console.info('[forecast] render started', {
        x: location.x,
        y: location.y,
        zoom: location.zoom === undefined ? 'provider-max' : location.zoom,
        theme: location.theme,
        alpha: location.alpha === 1
    });
    const metadataUrls = [
        'https://tiles.wo-cloud.com/metadata?type=geo',
        'https://tiles.wo-cloud.com/metadata?lg=wr&period=periodCurrentHighRes&type=period',
        'https://tiles.wo-cloud.com/metadata?lg=wr&period=periodCurrentLowRes&type=period'
    ];
    if (location.label === 1) {
        metadataUrls.push('https://radar.wo-cloud.com/cities/v29/cities/de.json');
    }
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

    const steps = Array.from({ length: FORECAST_HORIZON_SECONDS / FORECAST_FRAME_SECONDS + 1 },
        function (_, index) {
            const time = startTime + index * FORECAST_FRAME_SECONDS;
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
    console.info('[forecast] metadata ready', {
        nativeFrames: new Set(steps.flatMap(function (step) { return [step.before.id, step.after.id]; })).size,
        outputFrames: steps.length,
        sourceZoom: sourceZoom,
        elapsedSeconds: ((Date.now() - renderStartedAt) / 1000).toFixed(1)
    });

    const sourceFrames = new Map();
    steps.forEach(function (step) {
        sourceFrames.set(step.before.id, step.before);
        sourceFrames.set(step.after.id, step.after);
    });
    const uniqueFrames = Array.from(sourceFrames.values());
    const center = projectMercator(location.y, location.x, sourceZoom);
    const cityOverlay = location.alpha !== 1 && location.label === 1 ?
        buildCityOverlaySvg(cities, sourceZoom, center) : null;
    const geoTileCache = new Map();
    let nativeFramesCompleted = 0;
    const nativeFrameStartedAt = Date.now();
    const [baseImage, renderedRainFrames] = await Promise.all([
        location.alpha === 1 ? null :
            renderHamburgFrame(null, geo, sourceZoom, center, geoTileCache, 'base'),
        mapWithConcurrency(uniqueFrames, 3, async function (frame) {
            const image = await renderHamburgFrame(frame, geo, sourceZoom, center, new Map(), 'rain');
            nativeFramesCompleted += 1;
            console.info('[forecast] native frame ' + nativeFramesCompleted + '/' + uniqueFrames.length +
                ' completed in ' + ((Date.now() - nativeFrameStartedAt) / 1000).toFixed(1) + 's', frame.id);
            return {
                id: frame.id,
                image: image
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

    const rainPalette = await Promise.all(uniqueFrames.map(getRawRain)).then(function (images) {
        return buildRainPalette(images.map(function (image) { return image.data; }));
    });
    const fieldsById = new Map();
    function getDistanceFields(frame) {
        if (!fieldsById.has(frame.id)) {
            fieldsById.set(frame.id, getRawRain(frame).then(function (image) {
                return computeRainDistanceFields(cv, labelRainImage(image.data, rainPalette),
                    rainPalette.length + 1);
            }));
        }
        return fieldsById.get(frame.id);
    }

    async function morphSource(frame, flowSource, flowTarget, fraction, weight) {
        const [fields, flow] = await Promise.all([
            getDistanceFields(frame),
            fraction === 0 ? null : getFlow(flowSource, flowTarget)
        ]);
        return {
            fields: fields,
            positions: flow ? computeSourcePositions(flow, fraction) : null,
            weight: weight
        };
    }

    async function applyOverzoom(image) {
        if (overzoomScale <= 1) return image;
        const cropSize = Math.max(1, Math.round(512 / overzoomScale));
        const cropStart = Math.floor((512 - cropSize) / 2);
        return sharp(image)
            .extract({ left: cropStart, top: cropStart, width: cropSize, height: cropSize })
            .resize(512, 512, { fit: 'fill' })
            .png()
            .toBuffer();
    }

    const outputStartedAt = Date.now();
    const images = await mapWithConcurrency(steps, 3, async function (step, frameIndex) {
        const frameStartedAt = Date.now();
        let sources;
        if (step.extrapolate) {
            sources = [await morphSource(step.after, step.before, step.after, step.amount - 1, 1)];
        } else if (step.before.id === step.after.id || step.amount === 0) {
            sources = [await morphSource(step.before, null, null, 0, 1)];
        } else if (step.amount === 1) {
            sources = [await morphSource(step.after, null, null, 0, 1)];
        } else {
            sources = await Promise.all([
                morphSource(step.before, step.before, step.after, step.amount, 1 - step.amount),
                morphSource(step.after, step.after, step.before, 1 - step.amount, step.amount)
            ]);
        }
        const rainImage = await sharp(renderMorphedRain(sources, rainPalette), {
            raw: { width: 512, height: 512, channels: 4 }
        }).png().toBuffer();

        if (location.alpha === 1) {
            let rainColor = rainImage;
            if (location.theme === 'dark') {
                rainColor = await sharp(rainColor).negate({ alpha: false }).png().toBuffer();
            }
            const colorFrame = await applyOverzoom(await sharp(rainColor)
                .flatten({ background: '#000' })
                .png()
                .toBuffer());
            const alphaFrame = await applyOverzoom(
                await sharp(rainImage).extractChannel(3).png().toBuffer());
            console.info('[forecast] rain-only frame ' + (frameIndex + 1) + '/' + steps.length +
                ' completed in ' + ((Date.now() - frameStartedAt) / 1000).toFixed(2) + 's');
            return { color: colorFrame, alpha: alphaFrame };
        }

        let mapFrame = await sharp(baseImage).composite([{ input: rainImage }]).png().toBuffer();
        // Dark theme inverts only the WetterOnline imagery; city labels and the time box stay as-is.
        if (location.theme === 'dark') {
            mapFrame = await sharp(mapFrame).negate({ alpha: false }).png().toBuffer();
        }
        if (cityOverlay) {
            mapFrame = await sharp(mapFrame).composite([{ input: cityOverlay }]).png().toBuffer();
        }
        const centeredFrame = await applyOverzoom(mapFrame);
        // With noFooter the client draws the time box, so static rain yields identical frames.
        const image = location.noFooter === 1 ? centeredFrame : await sharp(centeredFrame)
            .composite([{
                input: buildTimeOverlaySvg(step.time,
                    steps.length > 1 ? frameIndex / (steps.length - 1) : 1)
            }])
            .png()
            .toBuffer();
        console.info('[forecast] frame ' + (frameIndex + 1) + '/' + steps.length +
            ' (+ ' + (frameIndex * FORECAST_FRAME_SECONDS / 60) + ' min) completed in ' +
            ((Date.now() - frameStartedAt) / 1000).toFixed(2) + 's; render elapsed ' +
            ((Date.now() - renderStartedAt) / 1000).toFixed(1) + 's');
        return image;
    });
    const data = await encodeAv1Video(location.alpha === 1 ?
        images.map(function (image) { return image.color; }) : images);
    const alphaData = location.alpha === 1 ?
        await encodeAv1Video(images.map(function (image) { return image.alpha; }), 40) : undefined;
    console.info('[forecast] AV1 encoded', {
        frames: steps.length,
        bytes: data.length,
        renderSeconds: ((Date.now() - renderStartedAt) / 1000).toFixed(1),
        encodeSeconds: ((Date.now() - outputStartedAt) / 1000).toFixed(1)
    });

    return {
        data: data,
        frameDelayMs: FORECAST_FRAME_DELAY_MS,
        zoom: zoom,
        sourceZoom: sourceZoom,
        x: location.x,
        y: location.y,
        theme: location.theme,
        label: location.label === 1 ? 1 : 0,
        alpha: location.alpha === 1 ? 1 : 0,
        noFooter: location.alpha === 1 || location.noFooter === 1 ? 1 : 0,
        start: steps[0].time,
        end: steps[steps.length - 1].time,
        frames: steps.length,
        alphaData: alphaData
    };
}

// CRF 48 keeps map lines and rain edges crisp at roughly 1/20 of an equivalent GIF's size.
async function encodeAv1Video(pngFrames, crf = 48) {
    const directory = await mkdtemp(path.join(tmpdir(), 'forecast-av1-'));
    const output = path.join(directory, 'forecast.mp4');
    try {
        await new Promise(function (resolve, reject) {
            const ffmpeg = spawn('ffmpeg', [
                '-hide_banner', '-loglevel', 'error', '-y',
                '-f', 'image2pipe', '-framerate', String(1000 / FORECAST_FRAME_DELAY_MS), '-c:v', 'png', '-i', '-',
                '-c:v', 'libsvtav1', '-preset', '6', '-crf', String(crf), '-pix_fmt', 'yuv420p',
                '-svtav1-params', 'lp=2',
                '-movflags', '+faststart', output
            ], { stdio: ['pipe', 'ignore', 'pipe'] });
            let stderr = '';
            ffmpeg.stderr.on('data', function (chunk) { stderr += chunk; });
            ffmpeg.on('error', reject);
            ffmpeg.on('close', function (code) {
                if (code === 0) resolve();
                else reject(new Error('ffmpeg exited with ' + code + ': ' + stderr.trim()));
            });
            ffmpeg.stdin.on('error', reject);
            for (const frame of pngFrames) ffmpeg.stdin.write(frame);
            ffmpeg.stdin.end();
        });
        return await readFile(output);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
}

const getCachedForecastVideo = createForecastCache(generateForecastVideo);

const server = http.createServer(async (req, res) => {
    if (req.url === '/healthz') {
        res.writeHead(200);
        res.end('OK');
        return;
    }

    const requestUrl = new URL(req.url, 'http://localhost');
    if (requestUrl.pathname === '/forecast' || requestUrl.pathname === '/alpha') {
        if (req.method !== 'GET') {
            res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8', 'Allow': 'GET' });
            res.end('Method not allowed');
            return;
        }

        try {
            const xParameter = requestUrl.searchParams.get('x');
            const yParameter = requestUrl.searchParams.get('y');
            const zoomParameter = requestUrl.searchParams.get('zoom');
            const themeParameter = requestUrl.searchParams.get('theme');
            const labelParameter = requestUrl.searchParams.get('label');
            const noFooterParameter = requestUrl.searchParams.get('noFooter');
            const alphaParameter = requestUrl.searchParams.get('alpha');
            const alpha = requestUrl.pathname === '/alpha' || alphaParameter === '1';
            const location = {
                x: xParameter === null ? HAMBURG.longitude : Number(xParameter),
                y: yParameter === null ? HAMBURG.latitude : Number(yParameter),
                zoom: zoomParameter === null ? undefined : Number(zoomParameter),
                theme: themeParameter === null ? 'light' : themeParameter,
                label: alpha ? 0 : (labelParameter === '1' ? 1 : 0),
                noFooter: alpha || noFooterParameter === '1' ? 1 : 0,
                alpha: alpha ? 1 : 0
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
            if (!FORECAST_THEMES.includes(location.theme)) {
                const error = new RangeError('theme must be one of: ' + FORECAST_THEMES.join(', '));
                error.statusCode = 400;
                throw error;
            }
            if (labelParameter !== null && labelParameter !== '0' && labelParameter !== '1') {
                const error = new RangeError('label must be 0 or 1');
                error.statusCode = 400;
                throw error;
            }
            if (noFooterParameter !== null && noFooterParameter !== '0' && noFooterParameter !== '1') {
                const error = new RangeError('noFooter must be 0 or 1');
                error.statusCode = 400;
                throw error;
            }
            if (alphaParameter !== null && alphaParameter !== '0' && alphaParameter !== '1') {
                const error = new RangeError('alpha must be 0 or 1');
                error.statusCode = 400;
                throw error;
            }

            const cached = await getCachedForecastVideo(location);
            const result = cached.result;
            const alphaMask = requestUrl.pathname === '/alpha';
            const data = alphaMask ? result.alphaData : result.data;
            const etag = alphaMask ? result.alphaEtag : result.etag;
            const headers = forecastResponseHeaders(result, cached.stale, alphaMask);
            if (req.headers['if-none-match'] === etag) {
                res.writeHead(304, headers);
                res.end();
                return;
            }
            res.writeHead(200, headers);
            res.end(data);
        } catch (error) {
            console.error('Forecast generation failed:', error);
            res.writeHead(error.statusCode || 502, {
                'Content-Type': 'text/plain; charset=utf-8',
                'Cache-Control': 'no-store'
            });
            res.end(error.statusCode ? error.message : 'WetterOnline forecast generation failed');
        }
        return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
});

server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
    if (process.env.FORECAST_DISABLE_WARMUP === '1') return;
    const defaultLocation = { x: HAMBURG.longitude, y: HAMBURG.latitude };
    const warmupStartedAt = Date.now();
    console.info('[forecast] startup warm-up started', defaultLocation);
    getCachedForecastVideo(defaultLocation)
        .then(function ({ result }) {
            console.info('[forecast] startup warm-up ready', {
                frames: result.frames,
                zoom: result.zoom,
                seconds: ((Date.now() - warmupStartedAt) / 1000).toFixed(1)
            });
        })
        .catch(function (error) {
            console.error('[forecast] startup warm-up failed', error);
        });
});
