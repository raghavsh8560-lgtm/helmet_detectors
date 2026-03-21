const GEMINI_API_KEY = ""; // Kept empty, handled securely by the backend now

// DOM Elements
const phase1 = document.getElementById("phase1");
const phase2 = document.getElementById("phase2");
const successScreen = document.getElementById("successScreen");
const startBtn = document.getElementById("startBtn");
const videoFeed = document.getElementById("videoFeed");
const captureCanvas = document.getElementById("captureCanvas");
const statusText = document.getElementById("statusText");
const alertModal = document.getElementById("alertModal");
const alertMessage = document.getElementById("alertMessage");
const closeAlertBtn = document.getElementById("closeAlertBtn");
const modalContent = document.querySelector(".modal-content");
const scanStatusBanner = document.getElementById("scanStatusBanner");
const scanMeBtn = document.getElementById("scanMeBtn");
const peopleCountEl = document.getElementById("peopleCount");
const helmetCountEl = document.getElementById("helmetCount");
const systemStatusEl = document.getElementById("systemStatus");

let mediaStream = null;
let scanInterval = null;
let validationStartTime = null;
const VALIDATION_DURATION_MS = 2000;
let isScanning = false;
let lastSpokenState = "";

function speakThrottled(text) {
    if (lastSpokenState !== text) {
        speak(text);
        lastSpokenState = text;
    }
}

// Speech Synthesis function
function speak(text) {
    if ('speechSynthesis' in window) {
        // Cancel any ongoing speech
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 1;
        utterance.pitch = 1;
        utterance.volume = 1;

        // Try to get a clear voice
        const voices = window.speechSynthesis.getVoices();
        // Fallback default if we find an English voice.
        const englishVoice = voices.find(v => v.lang.startsWith('en-'));
        if (englishVoice) {
            utterance.voice = englishVoice;
        }

        window.speechSynthesis.speak(utterance);
    } else {
        console.warn("Text-to-Speech not supported in this browser.");
    }
}

// Ensure voices are loaded (some browsers load them asynchronously)
window.speechSynthesis.onvoiceschanged = () => {
    window.speechSynthesis.getVoices();
};

// Switch Screens
function showScreen(screen) {
    phase1.classList.remove("active");
    phase2.classList.remove("active");
    successScreen.classList.remove("active");
    screen.classList.add("active");
}

function showAlert(message, isSuccess = false) {
    alertMessage.textContent = message;
    if (isSuccess) {
        modalContent.classList.add("success");
    } else {
        modalContent.classList.remove("success");
    }
    alertModal.classList.add("active");
}

function closeAlert() {
    alertModal.classList.remove("active");
}

closeAlertBtn.addEventListener("click", () => {
    closeAlert();
});

// Start Process
startBtn.addEventListener("click", async () => {
    showScreen(phase2);
    // Reset state
    validationStartTime = null;
    isScanning = true;
    lastSpokenState = "";
    updateBanner("Scanner initializing...", "normal");
    peopleCountEl.textContent = "0";
    helmetCountEl.textContent = "0";
    systemStatusEl.textContent = "Waiting...";
    systemStatusEl.className = "stat-value warn";
    
    await startCamera();

    // Allow a few seconds for the camera to initialize
    // The user will click "Scan Me" when ready.
});

scanMeBtn.addEventListener("click", async () => {
    if (!isScanning) return;
    
    // UI feedback
    updateBanner("Scanning...", "normal");
    scanMeBtn.disabled = true;
    scanMeBtn.textContent = "Scanning...";
    
    await captureAndAnalyze();
    
    scanMeBtn.disabled = false;
    scanMeBtn.textContent = "Scan Me";
});

function updateBanner(message, type) {
    if (scanStatusBanner) {
        scanStatusBanner.textContent = message;
        scanStatusBanner.className = "status-banner";
        if (type === "error") scanStatusBanner.classList.add("error");
        if (type === "success") scanStatusBanner.classList.add("success");
    }
}

async function startContinuousScanning() {
    // Deprecated function since we use simple button trigger now
}

async function startCamera() {
    try {
        mediaStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
        videoFeed.srcObject = mediaStream;
    } catch (err) {
        console.error("Camera access denied:", err);
        statusText.textContent = "Error: Camera access required.";
        speak("Camera access required.");
        setTimeout(() => showScreen(phase1), 3000);
    }
}

function stopCamera() {
    if (mediaStream) {
        mediaStream.getTracks().forEach(track => track.stop());
        mediaStream = null;
        videoFeed.srcObject = null;
    }
}

async function captureAndAnalyze() {
    if (!isScanning) return;

    // Capture from video feed
    const context = captureCanvas.getContext("2d");
    captureCanvas.width = videoFeed.videoWidth;
    captureCanvas.height = videoFeed.videoHeight;
    // For mirroring the canvas (front camera usually mirrored)
    context.translate(captureCanvas.width, 0);
    context.scale(-1, 1);
    context.drawImage(videoFeed, 0, 0, captureCanvas.width, captureCanvas.height);

    const base64Image = captureCanvas.toDataURL("image/jpeg").split(",")[1]; // Remove data URL prefix

    try {
        const result = await analyzeWithGemini(base64Image);
        handleResult(result);
    } catch (error) {
        console.error("Analysis failed:", error);
        updateBanner(`Analysis error: ${error.message}`, "error");
        systemStatusEl.textContent = "Error";
        systemStatusEl.className = "stat-value warn";
        validationStartTime = null; // Reset validation on error
    }
}

async function analyzeWithGemini(base64Image) {
    const response = await fetch("https://helmet-detector.onrender.com/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: base64Image })
    });

    if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        console.error("API Error Response:", errData);
        throw new Error(errData.error || `API Error ${response.status}`);
    }

    const data = await response.json();
    return data;
}

function handleResult(result) {
    if (!isScanning) return;

    const { people_count, helmet_count, turban_count = 0 } = result;
    console.log("Analysis Result:", result);

    peopleCountEl.textContent = people_count;
    helmetCountEl.textContent = helmet_count + turban_count; // Combines safe headgears

    if (people_count > 2) {
        validationStartTime = null;
        updateBanner("Only two people allowed.", "error");
        systemStatusEl.textContent = "Overcrowded";
        systemStatusEl.className = "stat-value warn";
        speakThrottled("It is a two-seater. Only two people can go.");
    } else if (people_count > 0 && helmet_count === 0 && turban_count === 0) {
        validationStartTime = null;
        updateBanner("Please wear helmet or turban", "error");
        systemStatusEl.textContent = "Missing Helmet";
        systemStatusEl.className = "stat-value warn";
        speakThrottled("Please wear a helmet or turban to start.");
    } else if ((helmet_count + turban_count) < people_count && people_count > 0) {
        validationStartTime = null;
        updateBanner("Please wear helmet or turban", "error");
        systemStatusEl.textContent = "Missing Helmet";
        systemStatusEl.className = "stat-value warn";
        speakThrottled("Please wear a helmet or turban to start.");
    } else if (people_count === 0) {
        validationStartTime = null;
        updateBanner("No one detected.", "error");
        systemStatusEl.textContent = "Empty";
        systemStatusEl.className = "stat-value warn";
        speakThrottled("No one detected. Please try again.");
    } else {
        // Condition 3 (Success/Ready to go)
        if (turban_count > 0) {
            updateBanner("Yes, we sincerely obey and allow you.", "success");
            systemStatusEl.className = "stat-value good";
            speakThrottled("Yes, we sincerely obey and allow you. Engine started.");
        } else {
            updateBanner("Yes you are wearing a helmet", "success");
            systemStatusEl.className = "stat-value good";
            speakThrottled("Helmet detected. Validating...");
        }
        
        if (!validationStartTime) {
            validationStartTime = Date.now();
            systemStatusEl.textContent = `Validating... 2.0s`;
        } else {
            const timePassed = Date.now() - validationStartTime;
            if (timePassed >= VALIDATION_DURATION_MS) {
                // Success!
                isScanning = false;
                clearTimeout(scanInterval);
                speak("Ok, engine started.");
                stopCamera();
                showScreen(successScreen);
            } else {
                // Still validating
                const timeRemaining = Math.max(0, ((VALIDATION_DURATION_MS - timePassed) / 1000).toFixed(1));
                systemStatusEl.textContent = `Validating... ${timeRemaining}s`;
            }
        }
    }
}

function stopAndReturn() {
    stopCamera();
    setTimeout(() => {
        closeAlert();
        showScreen(phase1);
    }, 4500); // Wait for user to read alert / listen to TTS before resetting
}
