const GEMINI_API_KEY = "AIzaSyAqq5bA9Pr7xM8mQU4o9cWv5cEEmDJG9-o"; // PASTE YOUR KEY HERE

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

let mediaStream = null;

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
    statusText.textContent = "Scanning passengers...";
    await startCamera();

    // Allow a few seconds for the camera to initialize and user to position
    setTimeout(() => {
        captureAndAnalyze();
    }, 3000);
});

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
    statusText.textContent = "Analyzing image... Please hold still.";

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
        
        // Show exact error message to help identify if it's an API, safety, or network issue
        statusText.textContent = `Analysis failed: ${error.message}`;
        
        // Fallback catch - if API refuses to answer, it might be due to not finding anything identifiable
        if (error.message.includes("Failed to parse") || error.message.includes("Invalid response")) {
            speak("Helmet not found or unable to analyze image. Please try again.");
            showAlert("Analysis error: Helmet not found or image blocked.", false);
        } else {
            speak("System error. " + error.message);
            showAlert("Error: " + error.message, false);
        }
        
        setTimeout(() => {
            stopCamera();
            showScreen(phase1);
        }, 4000);
    }
}

async function analyzeWithGemini(base64Image) {
    if (GEMINI_API_KEY === "YOUR_GEMINI_API_KEY_HERE" || !GEMINI_API_KEY) {
        console.warn("No API key provided. Using mock response for demonstration.");
        statusText.textContent = "Mock API (No Key) - Starting in 2s...";
        // Simulated delay
        await new Promise(r => setTimeout(r, 2000));
        // Mock success case for easy demonstration if no API key is set
        return { people_count: 2, helmet_count: 2 };
    }

    const payload = {
        contents: [
            {
                parts: [
                    {
                        text: "Analyze this image. Count the exact number of people visible. Count the exact number of helmets being worn. Return the result strictly in JSON format: {\"people_count\": X, \"helmet_count\": Y}. If no people are detected, return 0 for both. Do not include any other text."
                    },
                    {
                        inline_data: {
                            mime_type: "image/jpeg",
                            data: base64Image
                        }
                    }
                ]
            }
        ],
        generationConfig: {
            temperature: 0.1,
            response_mime_type: "application/json"
        }
    };

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        const errText = await response.text();
        console.error("API Error Response:", errText);
        throw new Error(`API Error ${response.status}`);
    }

    const data = await response.json();
    
    // Check for safety restrictions or empty responses
    if (data.promptFeedback && data.promptFeedback.blockReason) {
        throw new Error("Content blocked by safety filters.");
    }
    
    if (!data.candidates || data.candidates.length === 0 || !data.candidates[0].content) {
        throw new Error("Invalid response structure from Gemini API.");
    }

    const textResponse = data.candidates[0].content.parts[0].text;
    
    // Extract JSON from response (in case Gemini wraps it in markdown blocks)
    try {
        const jsonMatch = textResponse.match(/\{[\s\S]*?\}/);
        if (jsonMatch) {
            return JSON.parse(jsonMatch[0]);
        } else {
            return JSON.parse(textResponse);
        }
    } catch (e) {
        console.error("Failed to parse JSON", e);
        throw new Error("Invalid response format");
    }
}

function handleResult(result) {
    const { people_count, helmet_count } = result;
    console.log("Analysis Result:", result);

    if (people_count > 2) {
        const msg = "It is a two-seater. Only two people can go.";
        speak(msg);
        showAlert(msg, false);
        stopAndReturn();
    } else if (people_count > 0 && helmet_count === 0) {
        const msg = "Helmet not found. Please wear a helmet to start.";
        speak(msg);
        showAlert(msg, false);
        stopAndReturn();
    } else if (helmet_count < people_count && people_count > 0) {
        const msg = "Sorry, please wear a helmet to start.";
        speak(msg);
        showAlert(msg, false);
        stopAndReturn();
    } else if (people_count === 0) {
        const msg = "No one detected. Please try again.";
        speak(msg);
        showAlert(msg, false);
        stopAndReturn();
    } else {
        // Condition 3 (Success/Ready to go): helmet_count == people_count (and people_count is 1 or 2)
        const msg = "Ok, engine started.";
        speak(msg);
        // Show success screen in green
        stopCamera();
        showScreen(successScreen);
    }
}

function stopAndReturn() {
    stopCamera();
    setTimeout(() => {
        closeAlert();
        showScreen(phase1);
    }, 4500); // Wait for user to read alert / listen to TTS before resetting
}
