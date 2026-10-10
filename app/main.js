import http from 'http';
import { createHash } from 'node:crypto';
import cvModule from '@techstark/opencv-js';
import sharp from 'sharp';

const PORT = Number(process.env.PORT || 3000);
const page = String.raw`<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="theme-color" content="#f5f7f8">
    <title>Hamburg Rain Radar</title>
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
    <style>
        :root {
            color-scheme: light;
            font-family: "Avenir Next", Avenir, "Segoe UI", sans-serif;
            color: #172a35;
            background: #f5f7f8;
            font-synthesis: none;
            text-rendering: optimizeLegibility;
        }

        * { box-sizing: border-box; }

        html, body { width: 100%; height: 100%; margin: 0; }

        body { min-width: 320px; overflow: hidden; }

        .topbar {
            position: absolute;
            z-index: 500;
            top: 16px;
            left: 16px;
            display: flex;
            align-items: center;
            gap: 14px;
            min-height: 54px;
            padding: 9px 15px;
            border: 1px solid rgba(27, 55, 68, .13);
            border-radius: 5px;
            background: rgba(255, 255, 255, .96);
            box-shadow: 0 3px 14px rgba(25, 48, 60, .12);
        }

        .mark {
            width: 30px;
            height: 30px;
            display: grid;
            place-items: center;
            border-radius: 4px;
            color: white;
            background: #087d9c;
            font-size: 13px;
            font-weight: 700;
        }

        .brand { font-size: 15px; font-weight: 700; line-height: 1.15; }
        .place { margin-top: 3px; color: #637782; font-size: 12px; }

        #map { position: absolute; inset: 0; background: #e8eff1; }

        .timeline {
            position: absolute;
            z-index: 500;
            left: 50%;
            bottom: 22px;
            display: grid;
            grid-template-columns: 1fr;
            align-items: center;
            gap: 8px;
            width: min(680px, calc(100% - 32px));
            padding: 10px 13px;
            transform: translateX(-50%);
            border: 1px solid rgba(27, 55, 68, .13);
            border-radius: 5px;
            background: rgba(255, 255, 255, .97);
            box-shadow: 0 3px 14px rgba(25, 48, 60, .15);
        }

        button { font: inherit; }

        .map-zoom { display: grid; }
        .map-zoom button {
            width: 30px;
            height: 30px;
            padding: 0;
            border: 0;
            color: #263c47;
            background: #fff;
            cursor: pointer;
            font-size: 20px;
            line-height: 1;
        }

        .map-zoom button + button { border-top: 1px solid #d5dfe2; }
        .map-zoom button:disabled { color: #a9b5ba; cursor: default; }
        .map-zoom button:focus-visible { position: relative; z-index: 1; outline: 3px solid #f0a900; }

        .mode-switch {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 3px;
            padding: 3px;
            border-radius: 4px;
            background: #eaf0f2;
        }

        .mode-tab {
            min-height: 30px;
            border: 0;
            border-radius: 3px;
            color: #526771;
            background: transparent;
            cursor: pointer;
            font-size: 12px;
        }

        .mode-tab[aria-pressed="true"] {
            color: #173544;
            background: #fff;
            box-shadow: 0 1px 3px rgba(25, 48, 60, .15);
            font-weight: 650;
        }

        .timeline-view {
            display: grid;
            grid-template-columns: 42px minmax(160px, 1fr) 76px;
            align-items: center;
            gap: 12px;
        }

        .timeline-view[hidden], .forecast-controls[hidden] { display: none; }

        .forecast-controls { display: grid; gap: 9px; }

        .forecast-heading, .forecast-footer {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
        }

        .forecast-heading { color: #526771; font-size: 12px; }
        #forecast-target { color: #173544; font-size: 15px; font-weight: 700; }
        #forecast-time { color: #173544; font-size: 12px; font-weight: 650; }

        .forecast-transport {
            display: grid;
            grid-template-columns: 38px minmax(0, 1fr);
            align-items: center;
            gap: 12px;
        }

        #forecast-play {
            width: 38px;
            height: 38px;
            border: 0;
            border-radius: 4px;
            color: white;
            background: #087d9c;
            cursor: pointer;
            font-size: 16px;
        }

        #forecast-play:hover { background: #066b85; }
        #forecast-play:focus-visible { outline: 3px solid #f0a900; outline-offset: 2px; }

        .forecast-range { display: grid; gap: 3px; }

        #forecast-step {
            width: 100%;
            margin: 0;
            accent-color: #087d9c;
            cursor: pointer;
        }

        #forecast-step:disabled { cursor: progress; }
        #forecast-source-time { color: #526771; font-size: 11px; }

        .forecast-footer {
            flex-wrap: wrap;
            color: #70828a;
            font-size: 10px;
        }

        .forecast-footer a { color: #176b82; }
        #forecast-status { color: #9b3c2e; font-size: 11px; }
        #forecast-status[hidden] { display: none; }

        #play {
            width: 38px;
            height: 38px;
            border: 0;
            border-radius: 4px;
            color: #fff;
            background: #087d9c;
            cursor: pointer;
            font-size: 16px;
        }

        #play:hover { background: #066b85; }
        #play:focus-visible, input:focus-visible { outline: 3px solid #f0a900; outline-offset: 2px; }

        .range-wrap { display: grid; gap: 3px; }

        #frames {
            width: 100%;
            margin: 0;
            accent-color: #087d9c;
            cursor: pointer;
        }

        .range-labels {
            display: flex;
            justify-content: space-between;
            color: #70828a;
            font-size: 10px;
        }

        #frame-time { color: #273c47; font-size: 12px; text-align: right; white-space: nowrap; }

        .legend {
            position: absolute;
            z-index: 500;
            right: 16px;
            bottom: 94px;
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 8px 10px;
            border: 1px solid rgba(27, 55, 68, .12);
            border-radius: 4px;
            background: rgba(255, 255, 255, .95);
            box-shadow: 0 2px 9px rgba(25, 48, 60, .10);
            color: #526771;
            font-size: 10px;
        }

        .legend-colors {
            width: 94px;
            height: 8px;
            border-radius: 2px;
            background: linear-gradient(90deg, #c6f6ff, #47c9f2, #2687e8, #1648ba, #752cad);
        }

        #status {
            position: absolute;
            z-index: 500;
            top: 82px;
            left: 16px;
            max-width: min(340px, calc(100% - 32px));
            padding: 8px 11px;
            border-radius: 4px;
            color: #435a65;
            background: rgba(255, 255, 255, .93);
            box-shadow: 0 2px 9px rgba(25, 48, 60, .10);
            font-size: 12px;
        }

        #status[hidden] { display: none; }

        .leaflet-control-attribution { font-size: 10px !important; }

        .leaflet-marker-icon.forecast-city-label {
            border: 0;
            background: transparent;
        }

        .forecast-city-name {
            display: block;
            color: #172229;
            font-size: 12px;
            font-weight: 500;
            text-align: center;
            white-space: nowrap;
            text-shadow: -1px -1px 0 #fff, 1px -1px 0 #fff, -1px 1px 0 #fff, 1px 1px 0 #fff;
        }

        @media (max-width: 520px) {
            .topbar { top: 10px; left: 10px; min-height: 48px; padding: 7px 10px; }
            #status { top: 68px; left: 10px; }
            .timeline { bottom: 28px; gap: 7px; width: calc(100% - 20px); padding: 8px 9px; }
            .timeline-view { grid-template-columns: 38px minmax(80px, 1fr) 62px; gap: 8px; }
            #play { width: 36px; height: 36px; }
            .forecast-transport { grid-template-columns: 36px minmax(0, 1fr); gap: 8px; }
            #forecast-play { width: 36px; height: 36px; }
            .forecast-footer { font-size: 9px; }
            .legend { right: 10px; bottom: 82px; }
        }
    </style>
</head>
<body>
    <header class="topbar">
        <div class="mark" aria-hidden="true">RR</div>
        <div>
            <div class="brand">Rain radar</div>
            <div class="place">Hamburg, Germany</div>
        </div>
    </header>
    <div id="map" role="application" aria-label="Interactive rain radar map centered on Hamburg"></div>
    <div id="status" role="status">Loading radar…</div>
    <div class="legend" aria-label="Rain intensity">
        <span>Light</span><div class="legend-colors" aria-hidden="true"></div><span>Heavy</span>
    </div>
    <div class="timeline">
        <div class="mode-switch" role="group" aria-label="Weather view">
            <button id="radar-mode" class="mode-tab" type="button" aria-pressed="true">Radar history</button>
            <button id="forecast-mode" class="mode-tab" type="button" aria-pressed="false">Next 90 min</button>
        </div>
        <div id="radar-controls" class="timeline-view">
            <button id="play" type="button" aria-label="Play radar animation" title="Play radar animation">▶</button>
            <label class="range-wrap" for="frames">
                <input id="frames" type="range" min="0" max="0" value="0" disabled aria-label="Radar time frame">
                <span class="range-labels"><span>Older</span><span>Latest</span></span>
            </label>
            <time id="frame-time">--:--</time>
        </div>
        <div id="forecast-controls" class="forecast-controls" hidden>
            <div class="forecast-heading">
                <div><strong id="forecast-target">+5 min</strong> forecast map</div>
                <time id="forecast-time">--:--</time>
            </div>
            <div class="forecast-transport">
                <button id="forecast-play" type="button" aria-label="Play forecast animation" title="Play forecast animation">▶</button>
                <label class="forecast-range" for="forecast-step">
                    <input id="forecast-step" type="range" min="0" max="17" value="0" disabled aria-label="Choose a 5-minute forecast interval">
                    <span class="range-labels"><span>+5 min</span><span>+90 min</span></span>
                </label>
            </div>
            <div id="forecast-source-time">Loading map frame…</div>
            <div class="forecast-footer">
                <span id="forecast-cadence">Five-minute selections use available forecast map frames.</span>
                <a href="https://www.wetteronline.de/regenradar/hamburg" target="_blank" rel="noreferrer">WetterOnline RegenRadar</a>
            </div>
            <div id="forecast-status" role="status" hidden></div>
        </div>
    </div>
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
    <script>
        const status = document.getElementById('status');
        const slider = document.getElementById('frames');
        const playButton = document.getElementById('play');
        const frameTime = document.getElementById('frame-time');
        const radarModeButton = document.getElementById('radar-mode');
        const forecastModeButton = document.getElementById('forecast-mode');
        const radarControls = document.getElementById('radar-controls');
        const forecastControls = document.getElementById('forecast-controls');
        const forecastSlider = document.getElementById('forecast-step');
        const forecastPlayButton = document.getElementById('forecast-play');
        const forecastTarget = document.getElementById('forecast-target');
        const forecastTime = document.getElementById('forecast-time');
        const forecastSourceTime = document.getElementById('forecast-source-time');
        const forecastCadence = document.getElementById('forecast-cadence');
        const forecastStatus = document.getElementById('forecast-status');
        const map = L.map('map', { zoomControl: false, minZoom: 2, maxZoom: 10 }).setView([53.55, 9.99], 9);

        const baseLayer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        }).addTo(map);
        const zoomButtons = {};
        const zoomControl = L.control({ position: 'topright' });
        zoomControl.onAdd = function () {
            const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control map-zoom');
            zoomButtons.in = L.DomUtil.create('button', '', container);
            zoomButtons.in.type = 'button';
            zoomButtons.in.textContent = '+';
            zoomButtons.in.title = 'Zoom in';
            zoomButtons.in.setAttribute('aria-label', 'Zoom in');
            zoomButtons.out = L.DomUtil.create('button', '', container);
            zoomButtons.out.type = 'button';
            zoomButtons.out.textContent = '−';
            zoomButtons.out.title = 'Zoom out';
            zoomButtons.out.setAttribute('aria-label', 'Zoom out');
            zoomButtons.in.addEventListener('click', function () {
                map.setView(map.getCenter(), Math.min(map.getZoom() + 1, map.getMaxZoom()), { animate: false });
            });
            zoomButtons.out.addEventListener('click', function () {
                map.setView(map.getCenter(), Math.max(map.getZoom() - 1, map.getMinZoom()), { animate: false });
            });
            L.DomEvent.disableClickPropagation(container);
            L.DomEvent.disableScrollPropagation(container);
            return container;
        };
        zoomControl.addTo(map);

        function updateZoomControls() {
            zoomButtons.in.disabled = map.getZoom() >= map.getMaxZoom();
            zoomButtons.out.disabled = map.getZoom() <= map.getMinZoom();
        }

        map.on('zoomend', updateZoomControls);
        updateZoomControls();

        const hamburgIcon = L.divIcon({
            className: '',
            html: '<span style="display:block;width:13px;height:13px;border:3px solid #fff;border-radius:50%;background:#e6463b;box-shadow:0 1px 5px #47545a"></span>',
            iconSize: [13, 13],
            iconAnchor: [6, 6]
        });
        L.marker([53.55, 9.99], { icon: hamburgIcon, keyboard: false, interactive: false }).addTo(map);

        let radarLayer;
        let frames = [];
        let timer;
        let forecastSteps = [];
        let forecastMapMetadata;
        let forecastCompositeLayer;
        let forecastGeoLayer;
        let forecastCityLayer;
        let forecastCities;
        let activeForecastFrameId;
        let forecastTimer;
        let forecastModeActive = false;
        let forecastLoaded = false;
        let forecastLoading = false;

        function showFrame(index) {
            const frame = frames[index];
            if (!frame) return;
            slider.value = String(index);
            frameTime.dateTime = new Date(frame.time * 1000).toISOString();
            frameTime.textContent = new Intl.DateTimeFormat('en-GB', {
                hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin'
            }).format(new Date(frame.time * 1000));
            if (forecastModeActive) return;
            if (radarLayer) map.removeLayer(radarLayer);
            radarLayer = L.tileLayer(frame.url, {
                tileSize: 256,
                maxNativeZoom: 7,
                maxZoom: 12,
                opacity: 1,
                zIndex: 10,
                attribution: '<a href="https://www.rainviewer.com/">RainViewer</a>'
            }).addTo(map);
        }

        function stopPlayback() {
            window.clearInterval(timer);
            timer = undefined;
            playButton.textContent = '▶';
            playButton.setAttribute('aria-label', 'Play radar animation');
            playButton.title = 'Play radar animation';
        }

        slider.addEventListener('input', function () {
            stopPlayback();
            showFrame(Number(slider.value));
        });

        playButton.addEventListener('click', function () {
            if (timer) {
                stopPlayback();
                return;
            }
            if (frames.length < 2) return;
            playButton.textContent = 'Ⅱ';
            playButton.setAttribute('aria-label', 'Pause radar animation');
            playButton.title = 'Pause radar animation';
            timer = window.setInterval(function () {
                const next = (Number(slider.value) + 1) % frames.length;
                showFrame(next);
            }, 850);
        });

        function formatForecastTime(timestamp) {
            return new Intl.DateTimeFormat('en-GB', {
                hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin'
            }).format(new Date(timestamp * 1000));
        }

        function parseForecastFrameTime(id) {
            const match = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})-/.exec(id);
            if (!match) return NaN;
            return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]),
                Number(match[4]), Number(match[5])) / 1000;
        }

        function buildForecastTileUrl(frame, coords) {
            const geo = forecastMapMetadata.geo;
            const zoom = Math.floor(coords.z);
            const baseX = coords.x * 2;
            const baseY = coords.y * 2;
            const geometryRoot = geo.staticLayer.path;
            const seamask = geo.staticLayer.lsmTopography;
            const topography = geo.staticLayer.rrTopography;
            const topographyExtension = topography.type[Math.max(0, Math.min(
                zoom - geo.minZoom, topography.type.length - 1))] || 'jpg';
            const baseTile = zoom + '/512/' + baseX + '_' + baseY;
            const seamaskPath = geometryRoot + seamask.path + 'ZL' + baseTile + '.png';
            const topographyPath = geometryRoot + topography.path + 'ZL' + baseTile + '.' + topographyExtension;
            const europeRain = frame.layers.europe && frame.layers.europe.rain;
            const globalRain = frame.layers.global && frame.layers.global.rain;
            const rainZoom = Math.min(zoom, (europeRain && europeRain.mnz) || 7);
            const rainScale = Math.pow(2, zoom - rainZoom);
            const rainX = Math.floor(coords.x / rainScale) * 2;
            const rainY = Math.floor(coords.y / rainScale) * 2;
            const rainOffsetX = coords.x - Math.floor(coords.x / rainScale) * rainScale;
            const rainOffsetY = coords.y - Math.floor(coords.y / rainScale) * rainScale;

            function rainPath(layer, kind) {
                if (!layer) return '';
                return layer.ptypPath + layer.path + '/' + layer.timePath.join('/') +
                    '/ZL' + rainZoom + '/522/' + kind + '/' + rainX + '_' + rainY + '.png';
            }

            const rainPaths = [rainPath(europeRain, 'sprite'), rainPath(globalRain, 'border')]
                .filter(Boolean).join(';');
            const tileSet = 'seamask|1;;0;0|' + seamaskPath +
                '$topo|1;;0;0|' + topographyPath +
                '$r|' + rainScale + ';;' + rainOffsetX + ';' + rainOffsetY + ';false|' + rainPaths;
            const url = new URL('https://tiles.wo-cloud.com/composite');
            url.searchParams.set('format', 'webp');
            url.searchParams.set('lg', 'rr');
            url.searchParams.set('tiles', btoa(tileSet));
            url.searchParams.set('time', frame.id);
            return url.toString();
        }

        function showForecastFrame(frame) {
            if (activeForecastFrameId === frame.id) return;
            if (forecastCompositeLayer) map.removeLayer(forecastCompositeLayer);
            if (radarLayer) map.removeLayer(radarLayer);
            if (map.hasLayer(baseLayer)) map.removeLayer(baseLayer);

            forecastCompositeLayer = L.tileLayer('', {
                tileSize: 512,
                minZoom: geoMinimumZoom(),
                maxZoom: forecastMapMetadata.geo.maxZoom,
                noWrap: true,
                attribution: '<a href="https://www.wetteronline.de/regenradar/hamburg">WetterOnline RegenRadar</a>'
            });
            forecastCompositeLayer.getTileUrl = function (coords) {
                return buildForecastTileUrl(frame, coords);
            };
            forecastCompositeLayer.addTo(map);
            if (forecastGeoLayer) map.removeLayer(forecastGeoLayer);
            forecastGeoLayer = L.tileLayer('', {
                tileSize: 512,
                minZoom: geoMinimumZoom(),
                maxZoom: forecastMapMetadata.geo.maxZoom,
                noWrap: true,
                zIndex: 20
            });
            forecastGeoLayer.getTileUrl = function (coords) {
                const version = forecastMapMetadata.geo.staticLayer.rrGeooverlay.currentVersion;
                return 'https://radar.wo-cloud.com/geo-overlay/rr_geooverlay/' + version +
                    '/ZL' + coords.z + '/512/' + (coords.x * 2) + '_' + (coords.y * 2) + '.svg';
            };
            forecastGeoLayer.addTo(map);
            activeForecastFrameId = frame.id;
            updateForecastCityLabels();
        }

        function geoMinimumZoom() {
            return forecastMapMetadata ? forecastMapMetadata.geo.minZoom : 2;
        }

        function updateForecastCityLabels() {
            if (!forecastModeActive || !forecastCities) return;
            if (forecastCityLayer) {
                forecastCityLayer.clearLayers();
            } else {
                forecastCityLayer = L.layerGroup().addTo(map);
            }

            const bounds = map.getBounds();
            const visibleCities = Object.values(forecastCities).filter(function (city) {
                return city.name && Number(city.population) >= 25000 &&
                    bounds.contains([Number(city.lat), Number(city.lon)]);
            }).sort(function (left, right) {
                return Number(right.population) - Number(left.population);
            }).slice(0, 30);

            visibleCities.forEach(function (city) {
                const label = document.createElement('span');
                label.className = 'forecast-city-name';
                label.textContent = city.name;
                forecastCityLayer.addLayer(L.marker([Number(city.lat), Number(city.lon)], {
                    icon: L.divIcon({
                        className: 'forecast-city-label',
                        html: label.outerHTML,
                        iconSize: [120, 18],
                        iconAnchor: [60, 9]
                    }),
                    keyboard: false,
                    interactive: false
                }));
            });
        }

        map.on('moveend', updateForecastCityLabels);

        function selectForecastStep(index) {
            const step = forecastSteps[index];
            if (!step) return;
            forecastSlider.value = String(index);
            forecastTime.dateTime = new Date(step.time * 1000).toISOString();
            forecastTime.textContent = formatForecastTime(step.time);
            forecastTarget.textContent = '+' + ((index + 1) * 5) + ' min';
            forecastSourceTime.textContent = 'Map frame valid at ' + formatForecastTime(step.frame.time) +
                ' · ' + step.frame.resolution + '-minute provider interval';
            showForecastFrame(step.frame);
        }

        function loadForecast() {
            if (forecastLoaded || forecastLoading) return;
            forecastLoading = true;
            forecastSlider.disabled = true;
            forecastStatus.textContent = 'Loading WetterOnline forecast maps…';
            forecastStatus.hidden = false;

            Promise.all([
                fetch('https://tiles.wo-cloud.com/metadata?type=geo'),
                fetch('https://tiles.wo-cloud.com/metadata?lg=wr&period=periodCurrentHighRes&type=period'),
                fetch('https://tiles.wo-cloud.com/metadata?lg=wr&period=periodCurrentLowRes&type=period'),
                fetch('https://radar.wo-cloud.com/cities/v29/cities/de.json')
                    .then(function (response) { return response.ok ? response.json() : {}; })
                    .catch(function () { return {}; })
            ])
                .then(function (responses) {
                    const metadataResponses = responses.slice(0, 3);
                    const failed = metadataResponses.find(function (response) { return !response.ok; });
                    if (failed) throw new Error('Forecast metadata returned HTTP ' + failed.status);
                    return Promise.all(metadataResponses.map(function (response) { return response.json(); }))
                        .then(function (metadata) { return metadata.concat(responses[3]); });
                })
                .then(function (data) {
                    const geo = data[0];
                    const highResolution = data[1];
                    const lowResolution = data[2];
                    forecastCities = data[3];
                    const mapZoom = Math.floor(map.getZoom());
                    const highStep = geo.timeRangeConfig.periodCurrentHighRes.timeResolution[mapZoom] || 5;
                    const lowStep = geo.timeRangeConfig.periodCurrentLowRes.timeResolution[mapZoom] || 15;
                    const now = Number(highResolution.timestamp);
                    const horizon = now + 90 * 60;
                    const nativeFrames = new Map();

                    [
                        { period: highResolution, resolution: highStep },
                        { period: lowResolution, resolution: lowStep }
                    ].forEach(function (source) {
                        source.period.timesteps.forEach(function (frame) {
                            const time = parseForecastFrameTime(frame.id);
                            const available = frame.available;
                            if (!Number.isFinite(time) || time <= now || time > horizon) return;
                            if (Array.isArray(available) && available.indexOf(source.resolution) === -1) return;
                            if (!nativeFrames.has(frame.id) || source.resolution < nativeFrames.get(frame.id).resolution) {
                                nativeFrames.set(frame.id, {
                                    id: frame.id,
                                    time: time,
                                    resolution: source.resolution,
                                    layers: frame.layers
                                });
                            }
                        });
                    });

                    forecastMapMetadata = { geo: geo };
                    const availableFrames = Array.from(nativeFrames.values()).sort(function (left, right) {
                        return left.time - right.time;
                    });
                    if (!availableFrames.length || availableFrames[availableFrames.length - 1].time < horizon - lowStep * 60) {
                        throw new Error('The map service does not cover the full next 90 minutes');
                    }

                    forecastSteps = Array.from({ length: 18 }, function (_, index) {
                        const time = now + (index + 1) * 5 * 60;
                        let frame = availableFrames[0];
                        availableFrames.forEach(function (candidate) {
                            if (candidate.time <= time) frame = candidate;
                        });
                        return { time: time, frame: frame };
                    });

                    const intervals = Array.from(new Set(availableFrames.map(function (frame) {
                        return frame.resolution;
                    }))).sort(function (left, right) { return left - right; });
                    forecastCadence.textContent = 'Five-minute selections; provider map frames update every ' +
                        intervals.join(' or ') + ' minutes.';
                    forecastSlider.disabled = false;
                    selectForecastStep(0);
                    forecastLoaded = true;
                    forecastStatus.hidden = true;
                })
                .catch(function (error) {
                    forecastSlider.disabled = true;
                    forecastStatus.textContent = 'Forecast maps unavailable. ' + error.message;
                    forecastStatus.hidden = false;
                })
                .finally(function () {
                    forecastLoading = false;
                });
        }

        function setTimelineMode(forecast) {
            forecastModeActive = forecast;
            radarModeButton.setAttribute('aria-pressed', String(!forecast));
            forecastModeButton.setAttribute('aria-pressed', String(forecast));
            radarControls.hidden = forecast;
            forecastControls.hidden = !forecast;
            if (forecast) {
                if (radarLayer) map.removeLayer(radarLayer);
                if (map.hasLayer(baseLayer)) map.removeLayer(baseLayer);
                if (forecastLoaded) selectForecastStep(Number(forecastSlider.value));
                else loadForecast();
            } else {
                stopForecastPlayback();
                if (forecastCompositeLayer) map.removeLayer(forecastCompositeLayer);
                if (forecastGeoLayer) map.removeLayer(forecastGeoLayer);
                if (forecastCityLayer) map.removeLayer(forecastCityLayer);
                forecastCompositeLayer = undefined;
                forecastGeoLayer = undefined;
                forecastCityLayer = undefined;
                activeForecastFrameId = undefined;
                if (!map.hasLayer(baseLayer)) baseLayer.addTo(map);
                showFrame(Number(slider.value));
            }
        }

        function stopForecastPlayback() {
            window.clearInterval(forecastTimer);
            forecastTimer = undefined;
            forecastPlayButton.textContent = '▶';
            forecastPlayButton.setAttribute('aria-label', 'Play forecast animation');
            forecastPlayButton.title = 'Play forecast animation';
        }

        radarModeButton.addEventListener('click', function () { setTimelineMode(false); });
        forecastModeButton.addEventListener('click', function () { setTimelineMode(true); });
        forecastSlider.addEventListener('input', function () {
            selectForecastStep(Number(forecastSlider.value));
        });
        forecastPlayButton.addEventListener('click', function () {
            if (forecastTimer) {
                stopForecastPlayback();
                return;
            }
            if (!forecastSteps.length) return;
            forecastPlayButton.textContent = 'Ⅱ';
            forecastPlayButton.setAttribute('aria-label', 'Pause forecast animation');
            forecastPlayButton.title = 'Pause forecast animation';
            forecastTimer = window.setInterval(function () {
                const next = (Number(forecastSlider.value) + 1) % forecastSteps.length;
                selectForecastStep(next);
            }, 850);
        });

        fetch('https://api.rainviewer.com/public/weather-maps.json')
            .then(function (response) {
                if (!response.ok) throw new Error('Radar service returned HTTP ' + response.status);
                return response.json();
            })
            .then(function (data) {
                const available = (data.radar && data.radar.past) || [];
                if (!available.length) throw new Error('No radar frames are currently available');
                frames = available.slice(-7).map(function (frame) {
                    return {
                        time: frame.time,
                        url: data.host + frame.path + '/256/{z}/{x}/{y}/2/1_1.png'
                    };
                });
                slider.max = String(frames.length - 1);
                slider.disabled = frames.length < 2;
                showFrame(frames.length - 1);
                status.hidden = true;
            })
            .catch(function (error) {
                status.textContent = 'Radar data could not be loaded. ' + error.message;
                status.hidden = false;
            });
    </script>
</body>
</html>`;

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
            const time = now + index * FORECAST_STEP_SECONDS;
            const nextIndex = availableFrames.findIndex(function (frame) { return frame.time >= time; });
            if (nextIndex === -1) {
                const lastFrame = availableFrames[availableFrames.length - 1];
                return { time: time, before: lastFrame, after: lastFrame, amount: 0 };
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
            const sourceFrame = useAfter ? step.after : step.before;
            const targetFrame = useAfter ? step.before : step.after;
            const fraction = useAfter ? 1 - step.amount : step.amount;
            const [source, flow] = await Promise.all([
                getRawRain(sourceFrame),
                getFlow(sourceFrame, targetFrame)
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

    if (req.method === 'GET' && req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(page);
        return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
});

server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
