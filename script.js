const GEMINI_API_KEY = ""; // Kept empty, handled securely by the backend now

// DOM Elements
const phase1 = document.getElementById("phase1");
const phasePassword = document.getElementById("phase-password");
const phaseLicense = document.getElementById("phase-license");
const phaseFaceVerify = document.getElementById("phase-face-verify");
const phase2 = document.getElementById("phase2");
const successScreen = document.getElementById("successScreen");
const startBtn = document.getElementById("startBtn");
const ownerPasswordInput = document.getElementById("ownerPasswordInput");
const verifyPasswordBtn = document.getElementById("verifyPasswordBtn");
const licenseInput = document.getElementById("licenseInput");
const verifyLicenseBtn = document.getElementById("verifyLicenseBtn");
const faceVerifyVideo = document.getElementById("faceVerifyVideo");
const verifyFaceBtn = document.getElementById("verifyFaceBtn");
const faceVerifyStatus = document.getElementById("faceVerifyStatus");
const faceCaptureCanvas = document.getElementById("faceCaptureCanvas");
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

const API_BASE_URL = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1" || window.location.protocol === "file:"
    ? "http://localhost:3000" 
    : "https://helmet-detector.onrender.com";

let mediaStream = null;
let faceMediaStream = null;
let currentUserIdForVerification = null;
let currentLicenseId = null;
let scanInterval = null;
let validationStartTime = null;
const VALIDATION_DURATION_MS = 2000;
let isScanning = false;
let lastSpokenState = "";

const OWNER_PASSWORD = "admin";
const LICENSE_DB = {
    // These photoId match the exact filenames in the backend /images folder (user1.jpg, user2.jpg, user3.jpg)
    "DL-8472": { name: "User 1 (Maroon)", photoId: "user1" },
    "DL-5921": { name: "User 2 (Black)", photoId: "user2" },
    "DL-1034": { name: "User 3 (Pink)", photoId: "user3" },
    
    // Mismatched ID to trigger failure
    "DL-FAIL-1": { name: "Dummy User", photoId: "user1" } // Expects User1's face. If anyone else scans, it will fail.
};

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
    if (phasePassword) phasePassword.classList.remove("active");
    if (phaseLicense) phaseLicense.classList.remove("active");
    if (phaseFaceVerify) phaseFaceVerify.classList.remove("active");
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
startBtn.addEventListener("click", () => {
    showScreen(phasePassword);
    ownerPasswordInput.value = "";
    speak("Please enter owner password.");
});

// Verify Password
verifyPasswordBtn.addEventListener("click", () => {
    if (ownerPasswordInput.value === OWNER_PASSWORD) {
        showScreen(phaseLicense);
        licenseInput.value = "";
        speak("Password accepted. Please enter your driving license number.");
    } else {
        showAlert("Incorrect Password!", false);
        speak("Incorrect password.");
    }
});

// Verify License
verifyLicenseBtn.addEventListener("click", async () => {
    const licenseId = licenseInput.value.trim().toUpperCase();
    if (LICENSE_DB[licenseId]) {
        currentUserIdForVerification = LICENSE_DB[licenseId].photoId;
        currentLicenseId = licenseId;
        
        showScreen(phaseFaceVerify);
        faceVerifyStatus.textContent = "Initializing camera...";
        faceVerifyStatus.style.color = "#aaa";
        
        try {
            faceMediaStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
            faceVerifyVideo.srcObject = faceMediaStream;
            faceVerifyStatus.textContent = "Please look directly at the camera and click verify.";
            speak("Please look at the camera to verify your identity.");
        } catch (err) {
            console.error("Camera access denied:", err);
            faceVerifyStatus.textContent = "Error: Camera access required.";
            speak("Camera access required.");
            setTimeout(() => showScreen(phaseLicense), 3000);
        }
    } else {
        showAlert("Invalid Driving License Number!", false);
        speak("Invalid license number.");
    }
});

// Verify Face via API
verifyFaceBtn.addEventListener("click", async () => {
    if (!faceMediaStream) return;
    
    verifyFaceBtn.disabled = true;
    verifyFaceBtn.textContent = "Verifying...";
    faceVerifyStatus.textContent = "Analyzing face... Please wait.";
    faceVerifyStatus.style.color = "#ffaa00";
    speak("Verifying face, please wait.");
    
    // Capture face
    const context = faceCaptureCanvas.getContext("2d");
    faceCaptureCanvas.width = faceVerifyVideo.videoWidth;
    faceCaptureCanvas.height = faceVerifyVideo.videoHeight;
    context.translate(faceCaptureCanvas.width, 0);
    context.scale(-1, 1);
    context.drawImage(faceVerifyVideo, 0, 0, faceCaptureCanvas.width, faceCaptureCanvas.height);
    
    const base64Image = faceCaptureCanvas.toDataURL("image/jpeg").split(",")[1];
    
    try {
        const response = await fetch(`${API_BASE_URL}/api/verify-face`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ 
                image: base64Image,
                userId: currentUserIdForVerification 
            })
        });

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.error || `API Error ${response.status}`);
        }

        const data = await response.json();
        
        if (data.match === true) {
            // STOP face camera, GO to phase 2
            faceMediaStream.getTracks().forEach(track => track.stop());
            faceMediaStream = null;
            faceVerifyVideo.srcObject = null;
            
            showScreen(phase2);
            // Reset scan state
            validationStartTime = null;
            isScanning = true;
            lastSpokenState = "";
            updateBanner("Scanner initializing...", "normal");
            peopleCountEl.textContent = "0";
            helmetCountEl.textContent = "0";
            systemStatusEl.textContent = "Waiting...";
            systemStatusEl.className = "stat-value warn";
            
            await startCamera();
            speak("Face verified successfully! Please click Scan Me when ready.");
        } else {
            // MATCH FALSE!
            faceVerifyStatus.textContent = "Sorry, face and ID did not match.";
            faceVerifyStatus.style.color = "#ff4444";
            speak("Sorry, face and ID did not match.");
            verifyFaceBtn.disabled = false;
            verifyFaceBtn.textContent = "Try Again";
        }
    } catch (error) {
        console.error("Face verify failed:", error);
        faceVerifyStatus.textContent = `Error: ${error.message}`;
        faceVerifyStatus.style.color = "#ff4444";
        verifyFaceBtn.disabled = false;
        verifyFaceBtn.textContent = "Try Again";
        speak("An error occurred during verification.");
    }
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
    const response = await fetch(`${API_BASE_URL}/api/analyze`, {
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
