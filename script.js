"use strict";

// --- Configuration ---
const INITIAL_CENTER_LON_LAT = [-98.5795, 39.8283]; // Approx. center of contiguous US
const MAX_GEO_DIAMETER_KM = 12760; // Approx. Earth diameter
const MIN_GEO_DIAMETER_KM = 0.1;   // 100 meters
const DATA_URL = 'data/ne_110m_land.geojson';
const SPHERE_COLOR = "#aadaff"; // Match container background
const LAND_COLOR = "#4e854e"; // A green color for land
const GRATICULE_COLOR = "#cccccc";
const BORDER_COLOR = "#ffffff"; // Border between land features
const CENTER_DOT_COLOR = "#ff0000";
const CENTER_DOT_RADIUS = 4;
const ROTATION_SPEED_FACTOR = 0.4; // Adjust sensitivity of rotation drag
const ANIMATION_LERP_FACTOR = 0.15; // Controls smoothness (0-1, lower is smoother but slower)

// --- Global State ---
let width, height, canvasSize;
let projection;
let pathGenerator;
let zoom;
let graticule = d3.geoGraticule10();
let landData = null; // Initialize as null
let currentTransform = d3.zoomIdentity; // Stores combined zoom/pan state from d3.zoom
let targetScale; // For smooth animation
let targetRotation; // [lambda, phi, gamma] - For smooth animation
let isRotating = false; // Flag for Ctrl+Drag or 2-finger drag rotation mode
let animationFrameRequest = null;
let devicePixelRatio = window.devicePixelRatio || 1; // Store DPR globally

// --- Global State ---
// ... (other variables)
let rotationDragStartCoords = null; // To store [x, y] at start of rotation drag
let rotationDragStartGamma = 0; // To store initial gamma at start of rotation drag

// --- DOM Elements ---
const container = d3.select("#map-container");
const canvas = d3.select("#map-canvas");
const context = canvas.node().getContext("2d");

// --- Initial Setup ---
function initializeMap() {
    console.log("Initializing map...");
    setupCanvasSize();
    if (!width || width <= 0 || !height || height <= 0) {
        console.error("Map initialization halted: Invalid canvas dimensions calculated.");
        context.fillStyle = 'red'; context.font = '16px sans-serif'; context.textAlign = 'center';
        context.fillText("Error: Cannot determine map size.", 50, 50);
        return;
    }
    setupProjection();
    setupPathGenerator();
    setupZoom(); // This might still log errors during setup, but should now recover
    loadMapData(); // This will trigger render on success/error

    // Listen for resize events
    window.addEventListener('resize', handleResize);
    canvas.on("dblclick.zoom", null); // Remove default dblclick zoom
    canvas.on("dblclick", handleDoubleClick); // Add our custom double-click reset
    console.log("Map initialization sequence complete (waiting for data).");
}

function setupCanvasSize() {
    console.log("Setting up canvas size...");
    devicePixelRatio = window.devicePixelRatio || 1; // Update DPR
    const containerRect = container.node().getBoundingClientRect();
    console.log("Container Rect:", containerRect);

    if (!containerRect || containerRect.width <= 0 || containerRect.height <= 0) {
        console.warn("Container dimensions not ready or invalid during setup:", containerRect);
        canvasSize = 300;
        console.warn(`Using fallback canvas size: ${canvasSize}`);
    } else {
       canvasSize = Math.min(containerRect.width, containerRect.height);
    }

    canvas.attr('width', canvasSize * devicePixelRatio);
    canvas.attr('height', canvasSize * devicePixelRatio);
    canvas.style('width', `${canvasSize}px`);
    canvas.style('height', `${canvasSize}px`);

    width = canvasSize;
    height = canvasSize;
    console.log(`Canvas size set (width/height): ${width}px / ${height}px, DPR: ${devicePixelRatio}`);
}


function setupProjection() {
    if (!width || width <= 0 || !height || height <= 0) {
        console.error("Cannot setup projection, invalid dimensions:", width, height); return;
    }
    console.log("Setting up projection...");
    projection = d3.geoOrthographic()
        .center([0, 0])
        .rotate([-INITIAL_CENTER_LON_LAT[0], -INITIAL_CENTER_LON_LAT[1], 0])
        .translate([width / 2, height / 2])
        .clipAngle(90);

    const initialScale = height / 2;
    console.log("Calculated initial projection scale:", initialScale);
    if (!initialScale || initialScale <= 0 || !isFinite(initialScale)) {
         console.error("Invalid initial scale calculated:", initialScale);
         projection.scale(100);
         console.warn("Using fallback projection scale: 100");
    } else {
        projection.scale(initialScale);
    }
    // Initialize target state based on initial projection
    targetRotation = projection.rotate();
    targetScale = projection.scale();
    console.log("Initial targetScale set to:", targetScale);
    console.log("Initial targetRotation set to:", targetRotation);
}

function setupPathGenerator() {
    if (!projection) { console.error("Cannot setup path generator, projection is missing."); return; }
    console.log("Setting up path generator...");
    pathGenerator = d3.geoPath(projection, context);
}

function calculateScaleLimits() {
    console.log("Calculating scale limits...");
    if (!height || height <= 0) { console.warn("Cannot calculate scale limits, invalid height:", height); return [1, 100]; }

    const maxDiameterScale = height / 2;
    const earthRadiusKm = 6371;
    const minDiameterArgument = Math.max(-1, Math.min(1, (MIN_GEO_DIAMETER_KM / 2) / earthRadiusKm));
    const minAngularDiameter = 2 * Math.asin(minDiameterArgument);
    let minDiameterScaleFactor;
    if (!minAngularDiameter || minAngularDiameter <= 0 || !isFinite(minAngularDiameter)) {
        console.warn("Could not calculate valid minimum angular diameter. Using large zoom factor.");
         minDiameterScaleFactor = 5000;
    } else {
       minDiameterScaleFactor = Math.PI / minAngularDiameter;
    }
    const minDiameterScale = maxDiameterScale * minDiameterScaleFactor;
    const practicalMinScale = Math.min(minDiameterScale, maxDiameterScale * 10000);
    const initialProjectionScale = height / 2;
     if (!initialProjectionScale || initialProjectionScale <= 0 || !isFinite(initialProjectionScale)) {
         console.warn("Invalid initialProjectionScale in calculateScaleLimits:", initialProjectionScale); return [1, 100];
     }
    const maxK = practicalMinScale / initialProjectionScale;
    const minK = 1.0;
    const finalMaxK = (!isFinite(maxK) || maxK <= minK) ? 1000 : maxK;
    console.log(`Calculated scale extent [minK, maxK]: [${minK}, ${finalMaxK}]`);
    return [minK, finalMaxK];
}


function setupZoom() {
     console.log("Setting up zoom...");
     if (!height || height <= 0 || !projection) { console.error("Cannot setup zoom, invalid height or missing projection:", height); return; }
    const [minK, maxK] = calculateScaleLimits();
     console.log("Using scale extent from calculation:", minK, maxK);
    zoom = d3.zoom()
        .scaleExtent([minK, maxK])
        .on("start", zoomStarted)
        .on("zoom", zoomed)
        .on("end", zoomEnded);
    canvas.call(zoom);
    const actualInitialProjectionScale = projection.scale();
    console.log("Projection scale for initial zoom setup:", actualInitialProjectionScale);
     if (!actualInitialProjectionScale || actualInitialProjectionScale <= 0 || !isFinite(actualInitialProjectionScale) || !targetScale || !isFinite(targetScale)) {
         console.error("Invalid scale values for initial zoom transform calculation - Applying identity fallback.");
         canvas.call(zoom.transform, d3.zoomIdentity); currentTransform = d3.zoomIdentity;
         return;
     }
     const initialK = targetScale / actualInitialProjectionScale;
     console.log("Calculated initial K for transform:", initialK);
     if (!isFinite(initialK)) {
        console.error("Calculated initial K is not finite - Applying identity fallback.");
         canvas.call(zoom.transform, d3.zoomIdentity); currentTransform = d3.zoomIdentity;
         return;
     }
    try {
       const initialTransform = d3.zoomIdentity.scale(initialK);
       console.log("Attempting to apply initial transform:", initialTransform);
       canvas.call(zoom.transform, initialTransform); // Apply immediately
       currentTransform = initialTransform; // Store the applied transform
       console.log("Initial zoom transform applied successfully (event will fire).");
    } catch(error) {
        // Catch errors during the *application* of the transform itself (less likely now)
        console.error("Critical Error applying initial zoom transform:", error);
        try {
           canvas.call(zoom.transform, d3.zoomIdentity); currentTransform = d3.zoomIdentity;
           console.warn("Applied d3.zoomIdentity as fallback after critical error.");
        } catch (fallbackError) { console.error("Error applying fallback identity transform:", fallbackError); }
    }
}


async function loadMapData() {
    console.log(`Loading map data from: ${DATA_URL}...`);
    try {
        const loadedData = await d3.json(DATA_URL);
        if (loadedData && loadedData.type === "FeatureCollection" && loadedData.features?.length > 0) {
            landData = loadedData;
            console.log(`Map data loaded successfully. Type: ${landData.type}, Features: ${landData.features.length}`);
        } else {
            console.warn("Data loaded, but invalid or empty FeatureCollection:", loadedData);
            landData = null;
        }
    } catch (error) {
        console.error("Error loading map data:", error);
        landData = null;
    } finally {
        console.log("Data load attempt finished. Requesting initial render and starting animation loop.");
        requestAnimationFrame(render);
        startAnimationLoop(); // Start the loop now data attempt is done
    }
}

// --- Event Handlers ---

function zoomStarted(event) {
    console.log("Zoom started");
    canvas.style('cursor', 'grabbing');
    // Check for sourceEvent *before* accessing properties
    isRotating = event.sourceEvent && (event.sourceEvent.ctrlKey || (event.sourceEvent.touches && event.sourceEvent.touches.length > 1));

    // --- ADDED: Store rotation start info ---
    if (isRotating && event.sourceEvent) {
        rotationDragStartCoords = d3.pointer(event.sourceEvent, canvas.node());
        // Ensure targetRotation is initialized before accessing
         if (!targetRotation) targetRotation = projection.rotate();
        rotationDragStartGamma = targetRotation[2]; // Store initial gamma
        console.log("Rotation drag started at:", rotationDragStartCoords, "Initial Gamma:", rotationDragStartGamma);
    } else {
        rotationDragStartCoords = null; // Ensure reset if not rotating
    }
    // --- END ADDED ---

    if (animationFrameRequest) { cancelAnimationFrame(animationFrameRequest); animationFrameRequest = null; }
}

function zoomed(event) {
    currentTransform = event.transform;
    const initialProjectionScale = height / 2;
    targetScale = currentTransform.k * initialProjectionScale;

    if (!targetRotation) targetRotation = projection.rotate();
    const previousLambda = targetRotation[0];
    const previousPhi = targetRotation[1];
    const previousGamma = targetRotation[2]; // Use previous target gamma as base

    if (event.sourceEvent) {
        // --- MODIFIED: Rotation Logic ---
        isRotating = event.sourceEvent.ctrlKey || (event.sourceEvent.touches && event.sourceEvent.touches.length > 1);

        if (isRotating && rotationDragStartCoords) {
            // --- Rotation (Roll/Gamma) Implementation ---
            const pointer = d3.pointer(event.sourceEvent, canvas.node());
            const center = [width / 2, height / 2];

            // Calculate angle of vector from center to start point
            const startAngle = Math.atan2(rotationDragStartCoords[1] - center[1], rotationDragStartCoords[0] - center[0]);
            // Calculate angle of vector from center to current point
            const currentAngle = Math.atan2(pointer[1] - center[1], pointer[0] - center[0]);

            // Calculate the change in angle
            let angleDelta = currentAngle - startAngle; // Radians

            // Convert delta to degrees for D3 rotation
            const angleDeltaDegrees = angleDelta * 180 / Math.PI;

            // Apply the delta to the gamma captured at the *start* of the rotation drag
            let newGamma = rotationDragStartGamma + angleDeltaDegrees;

            // Update only the gamma component of the target rotation
            targetRotation = [previousLambda, previousPhi, newGamma];

        } else if (!isRotating) { // Ensure we only pan if NOT rotating
            // --- Panning Logic (Lambda, Phi) ---
            const pointer = d3.pointer(event.sourceEvent, canvas.node());
            const tempProjection = d3.geoOrthographic()
                .scale(projection.scale())
                .rotate(targetRotation)
                .translate([width / 2, height / 2]);
            const p1Geo = tempProjection.invert(pointer);

            if (p1Geo) { // If pointer is on the globe
                const { movementX, movementY } = event.sourceEvent;
                if (movementX !== undefined && movementY !== undefined && (movementX !== 0 || movementY !== 0)) {
                     const k_scale = projection.scale();
                     const anglePerPixel = (180 / k_scale) * 0.8;
                     let newLambda = previousLambda + movementX * anglePerPixel;
                     let newPhi = previousPhi - movementY * anglePerPixel;
                     newPhi = Math.max(-89.99, Math.min(89.99, newPhi));
                     targetRotation = [newLambda, newPhi, previousGamma]; // Update target lambda/phi, keep gamma
                } else { targetRotation = [previousLambda, previousPhi, previousGamma]; } // No movement
            } else { targetRotation = [previousLambda, previousPhi, previousGamma]; } // Pointer off globe
        }
         // --- END MODIFIED ---

    } else { // Programmatic event
        console.log("Programmatic zoom event - skipping manual pan/rotate.");
        targetRotation = [previousLambda, previousPhi, previousGamma]; // Maintain target rotation
    }

    if (!animationFrameRequest) { startAnimationLoop(); }
}


function zoomEnded(event) {
    console.log("Zoom ended");
    canvas.style('cursor', 'grab');
    isRotating = false; // Reset rotation flag
    rotationDragStartCoords = null; // ADDED: Reset rotation start coords
    if (!animationFrameRequest) { startAnimationLoop(); } // Settle animation
}

function handleResize() {
    console.log("Resize event detected");
    setupCanvasSize(); // Recalculate size and update globals (width, height, dpr)
    if (!width || width <= 0 || !height || height <= 0) { console.error("Resize handler failed: Invalid canvas dimensions."); return; }
    if (!projection || !zoom) { console.error("Cannot handle resize, projection or zoom missing."); return; }

    // Update projection center and base scale
    projection.translate([width / 2, height / 2]);
    const newInitialScale = height / 2; // Recalculate base scale for orthographic
    projection.scale(newInitialScale);

    // Update zoom extent based on new size
    const [minK, maxK] = calculateScaleLimits();
    zoom.scaleExtent([minK, maxK]);

    // Update target scale based on current zoom factor (k) and NEW base scale
    const currentK = currentTransform ? currentTransform.k : 1.0; // Use current k
    targetScale = currentK * newInitialScale;

    // Update target rotation to match current projection state after resize?
    // Or keep the previous target? Let's keep previous target to avoid jumps.
    // targetRotation = projection.rotate(); // Option 1: Update to current
     if (!targetRotation) targetRotation = projection.rotate(); // Ensure target exists (use current if first time)

    // Update D3's internal transform state to reflect the current K at the new size
    // We need to apply a transform that represents the *current zoom level* (k)
    // but centered correctly for the new size (implicitly handled by projection.translate)
     const newTransform = d3.zoomIdentity.scale(currentK); // Create transform with correct K
     canvas.call(zoom.transform, newTransform); // Apply it programmatically
     currentTransform = newTransform; // Update our state tracker

    console.log("Resize handler finished, new targetScale:", targetScale);

    // Ensure rendering happens & animation continues if needed
    if (!animationFrameRequest) { startAnimationLoop(); }
    else { requestAnimationFrame(render); } // Trigger a single render if loop was already running
}

function handleDoubleClick() {
    console.log("Double click detected - Resetting view");
    if (!projection || !zoom) { console.error("Cannot handle double-click, projection or zoom missing."); return; }

    // Define the target state for reset
    const initialProjectionScale = height / 2; // Target scale is the base scale
    const targetResetRotation = [-INITIAL_CENTER_LON_LAT[0], -INITIAL_CENTER_LON_LAT[1], 0]; // Target rotation

    // Update our internal targets for the animation loop
    targetScale = initialProjectionScale;
    targetRotation = targetResetRotation;

    // Use D3's transition to smoothly change the zoom behavior's transform
    // We want to transition to k=1 (base scale), x=0, y=0 (centered)
    canvas.transition()
        .duration(750)
        .call(zoom.transform, d3.zoomIdentity); // Transition to identity transform (k=1)

    console.log("Reset initiated via d3.transition (will trigger zoom events)");
    // The transition will fire 'zoom' events, updating currentTransform and targets via zoomed()
    // Ensure the animation loop is running to apply the final state smoothly
    if (!animationFrameRequest) { startAnimationLoop(); }
}


// --- Animation Loop ---
function startAnimationLoop() {
   if (animationFrameRequest) { return; }
   if (!projection) { console.warn("Cannot start animation loop, projection not ready."); return; }
    console.log("Starting animation loop...");

    let frameCount = 0;

    function animateFrame() {
        const currentScale = projection.scale();
        const currentRotation = projection.rotate();

        // Ensure targets are valid, use current state as fallback
        if (!isFinite(targetScale) || targetScale <= 0) targetScale = currentScale;
        if (!targetRotation || targetRotation.length !== 3 || !targetRotation.every(r => isFinite(r))) {
            targetRotation = [...currentRotation];
        }


        let scaleChanged = false;
        let rotationChanged = false;
        const scaleThreshold = 0.01;
        const rotationThreshold = 0.01; // degrees

        // Interpolate Scale
        if (Math.abs(currentScale - targetScale) > scaleThreshold) {
            const interpolatedScale = d3.interpolate(currentScale, targetScale)(ANIMATION_LERP_FACTOR);
            projection.scale(interpolatedScale);
            scaleChanged = true;
        } else if (currentScale !== targetScale) {
            projection.scale(targetScale); scaleChanged = true;
        }

        // Interpolate Rotation
        const newRotation = [...currentRotation];
        for (let i = 0; i < 3; i++) {
            let diff = targetRotation[i] - currentRotation[i];
            if (i === 0 || i === 2) { // Handle angle wrapping
                 while (diff < -180) diff += 360;
                 while (diff > 180) diff -= 360;
            }
            // Check threshold AFTER calculating wrapped difference
            if (Math.abs(diff) > rotationThreshold) {
                 newRotation[i] = currentRotation[i] + diff * ANIMATION_LERP_FACTOR;
                rotationChanged = true;
            } else if (currentRotation[i] !== targetRotation[i]) {
                newRotation[i] = targetRotation[i]; rotationChanged = true; // Snap
            }
        }

        if (rotationChanged) { projection.rotate(newRotation); }

        // Render if changes occurred or forcing initial frames
        const forceRenderFrames = 5;
        if (scaleChanged || rotationChanged || frameCount < forceRenderFrames) {
            render();
            animationFrameRequest = requestAnimationFrame(animateFrame);
        } else {
            animationFrameRequest = null; // Stop
            console.log("Animation loop stopped - target reached.");
            render(); // Final render at exact target
        }
        frameCount++;
    }
    animationFrameRequest = requestAnimationFrame(animateFrame);
}

// --- Rendering Function ---
function render() {
    if (!context || !projection || !pathGenerator || !width || !height) {
        console.warn("Render skipped: context, projection, pathGenerator, width, or height missing."); return;
    }

    context.save();
    context.clearRect(0, 0, width * devicePixelRatio, height * devicePixelRatio);
    context.scale(devicePixelRatio, devicePixelRatio); // Apply scaling

    // 1. Draw background sphere
    try {
        context.beginPath(); pathGenerator({ type: "Sphere" });
        context.fillStyle = SPHERE_COLOR; context.fill();
    } catch (e) { console.error("Error drawing sphere:", e); }

    // 2. Draw graticules
    try {
        context.beginPath(); pathGenerator(graticule); // Generate path
        context.strokeStyle = GRATICULE_COLOR;
        context.lineWidth = 0.5; // Logical pixel width
        context.stroke(); // Stroke the path
    } catch (e) { console.error("Error drawing graticule:", e); }

    // 3. Draw land polygons
    if (landData) {
        try {
            context.beginPath(); pathGenerator(landData);
            context.fillStyle = LAND_COLOR; context.fill();
            context.strokeStyle = BORDER_COLOR; context.lineWidth = 0.3;
            context.stroke();
        } catch (pathError) { console.error("Error during path generation or drawing for landData:", pathError); }
    }

    // 4. Draw center dot
    try {
        const centerX = Math.round(width / 2); const centerY = Math.round(height / 2);
        const dotRadius = CENTER_DOT_RADIUS;
        context.beginPath(); context.arc(centerX, centerY, dotRadius, 0, 2 * Math.PI);
        context.fillStyle = CENTER_DOT_COLOR; context.fill();
    } catch (e) { console.error("Error drawing center dot:", e); }

    context.restore(); // Restore context state
}

// --- Start the application ---
initializeMap();