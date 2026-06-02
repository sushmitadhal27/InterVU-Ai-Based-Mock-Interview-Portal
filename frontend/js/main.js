// DOM Elements
const chatMessages = document.getElementById('chatMessages');
const userInput = document.getElementById('userInput');
const sendBtn = document.getElementById('sendBtn');
const wordCount = document.getElementById('wordCount');
const currentQuestion = document.getElementById('currentQuestion');
const avatarCircle = document.getElementById('avatarCircle');
const aiStatus = document.getElementById('aiStatus');
const speakingIndicator = document.getElementById('speakingIndicator');
const recordingIndicator = document.getElementById('recordingIndicator');
const statusBar = document.getElementById('statusBar');
const countdownTimer = document.getElementById('countdownTimer');
const videoPlaceholder = document.getElementById('videoPlaceholder');
const studentVideo = document.getElementById('studentVideo');
const recordBtn = document.getElementById('recordBtn');
const micBtn = document.getElementById('micBtn');
const videoBtn = document.getElementById('videoBtn');
const endBtn = document.getElementById('endBtn');
const startPrompt = document.getElementById('startPrompt');
const startInterviewBtn = document.getElementById('startInterviewBtn');
const connectionDot = document.getElementById('connectionDot');
const connectionText = document.getElementById('connectionText');
const notificationArea = document.getElementById('notificationArea');
const questionTimerDisplay = document.getElementById('questionTimer');
const timerProgress = document.getElementById('timerProgress');

// State variables
let ws = null;
let sessionId = 'user_' + Math.random().toString(36).substr(2, 9);
let isRecording = false;
let isMicOn = true;
let isVideoOn = true;
let isInterviewActive = false;
let currentStreamingMessage = null;
let recognition = null;
let synthesis = window.speechSynthesis;
let voices = [];
let sophiaVoice = null;
let countdown = 900; // 15 minutes in seconds
let mediaStream = null;
let isConnected = false;
let reconnectAttempts = 0;
const maxReconnectAttempts = 3;
let manualStop = false;
let usingFallback = false;

// Timer variables
let questionTimer = null;
let questionTimeLeft = 60;
let currentQuestionTimerActive = false;

// ========== NOTIFICATION SYSTEM ==========
function showNotification(message, type = 'info', duration = 3000) {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.innerHTML = `
        <span>${message}</span>
        <span style="margin-left: auto; cursor: pointer;" onclick="this.parentElement.remove()">✕</span>
    `;
    
    notificationArea.appendChild(notification);
    
    setTimeout(() => {
        notification.remove();
    }, duration);
}

// ========== TIMER FUNCTIONS ==========
function startQuestionTimer(duration = 60) {
    // Clear any existing timer
    if (questionTimer) {
        clearInterval(questionTimer);
    }
    
    questionTimeLeft = duration;
    currentQuestionTimerActive = true;
    
    // Update display immediately
    updateTimerDisplay();
    
    questionTimer = setInterval(() => {
        if (!isInterviewActive || !currentQuestionTimerActive) {
            return;
        }
        
        questionTimeLeft--;
        updateTimerDisplay();
        
        // TIME'S UP - 60 seconds finished, no answer given
        if (questionTimeLeft <= 0) {
            clearInterval(questionTimer);
            currentQuestionTimerActive = false;
            
            // Mark current question as 0 (no answer)
            const emptyAnswer = "[No answer given]";
            
            // Show notification
            showNotification('⏱️ Time\'s up! Moving to next question.', 'warning');
            
            // Add empty message to chat (optional - you can remove this if you don't want to show)
            addMessage('system', '⏱️ Time\'s up! Moving to next question.');
            
            // Send empty answer to backend
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'answer',
                    text: emptyAnswer,
                    wordCount: 0
                }));
            }
            
            // Clear any streaming message
            if (currentStreamingMessage) {
                currentStreamingMessage.remove();
                currentStreamingMessage = null;
            }
            
            userInput.value = '';
            
            // Reset timer display
            questionTimerDisplay.textContent = '0s';
            timerProgress.style.width = '0%';
            
            // Stop recording if active
            if (isRecording) {
                isRecording = false;
                recordBtn.classList.remove('record');
                if (recognition) {
                    try { recognition.stop(); } catch (e) {}
                }
            }
            
            // The backend will automatically send the next question
            // We just wait for the 'question' message from WebSocket
        }
    }, 1000);
}

function updateTimerDisplay() {
    if (!questionTimerDisplay || !timerProgress) return;
    
    questionTimerDisplay.textContent = `${questionTimeLeft}s`;
    
    // Calculate percentage
    const percentage = (questionTimeLeft / 60) * 100;
    timerProgress.style.width = `${percentage}%`;
    
    // Add warning class when less than 10 seconds
    if (questionTimeLeft <= 10) {
        questionTimerDisplay.classList.add('warning');
        timerProgress.classList.add('warning');
    } else {
        questionTimerDisplay.classList.remove('warning');
        timerProgress.classList.remove('warning');
    }
}

function stopQuestionTimer() {
    if (questionTimer) {
        clearInterval(questionTimer);
        questionTimer = null;
    }
    currentQuestionTimerActive = false;
    if (questionTimerDisplay) {
        questionTimerDisplay.textContent = '60s';
        questionTimerDisplay.classList.remove('warning');
    }
    if (timerProgress) {
        timerProgress.style.width = '100%';
        timerProgress.classList.remove('warning');
    }
}

function resetQuestionTimer() {
    stopQuestionTimer();
    questionTimeLeft = 60;
    if (questionTimerDisplay) {
        questionTimerDisplay.textContent = '60s';
    }
    if (timerProgress) {
        timerProgress.style.width = '100%';
    }
}

// ========== TEXT TO SPEECH SETUP ==========
function loadVoices() {
    voices = synthesis.getVoices();
    sophiaVoice = voices.find(voice => 
        voice.name.includes('Female') || 
        voice.name.includes('Google UK') ||
        voice.name.includes('Samantha') ||
        voice.name.includes('Microsoft Zira') ||
        voice.name.includes('Female')
    );
    
    if (!sophiaVoice) {
        sophiaVoice = voices.find(voice => voice.lang.includes('en'));
    }
    
    console.log('Voice loaded:', sophiaVoice ? sophiaVoice.name : 'Default voice');
}

if (synthesis) {
    loadVoices();
    if (synthesis.onvoiceschanged !== undefined) {
        synthesis.onvoiceschanged = loadVoices;
    }
}

// ========== TEXT TO SPEECH FUNCTION ==========
function speakText(text, isQuestion = false) {
    if (!synthesis) {
        console.log('Speech synthesis not supported');
        return;
    }
    
    synthesis.cancel();
    
    const utterance = new SpeechSynthesisUtterance(text);
    
    if (sophiaVoice) {
        utterance.voice = sophiaVoice;
    }
    
    utterance.pitch = 1.0;
    utterance.rate = 0.9;
    utterance.volume = 1.0;
    
    utterance.onstart = function() {
        updateAvatarStatus('speaking');
        console.log('Sophia speaking:', text.substring(0, 50) + '...');
    };
    
    utterance.onend = function() {
        updateAvatarStatus('listening');
        console.log('Sophia finished speaking');
        
        if (isQuestion && isInterviewActive) {
            setTimeout(() => {
                if (!isRecording && !usingFallback) {
                    recordBtn.click();
                } else if (usingFallback) {
                    showNotification('✏️ Please type your answer', 'info');
                    userInput.focus();
                }
            }, 500);
        }
    };
    
    utterance.onerror = function(event) {
        console.error('Speech error:', event.error);
        updateAvatarStatus('listening');
    };
    
    synthesis.speak(utterance);
}

// ========== SPEECH RECOGNITION SETUP ==========
function initSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    
    if (!SpeechRecognition) {
        console.log('Speech recognition not supported');
        showNotification('Speech recognition not available. Using text mode.', 'warning');
        setupFallbackMode();
        return false;
    }
    
    try {
        recognition = new SpeechRecognition();
        
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'en-US';
        recognition.maxAlternatives = 1;
        
        recognition.onstart = function() {
            console.log('🎤 Speech recognition started');
            showNotification('🎤 Listening... (speak now)', 'info', 2000);
            updateAvatarStatus('listening');
        };
        
        recognition.onresult = function(event) {
            if (!isInterviewActive) return;
            
            let interimTranscript = '';
            let finalTranscript = '';
            
            for (let i = event.resultIndex; i < event.results.length; i++) {
                const transcript = event.results[i][0].transcript;
                if (event.results[i].isFinal) {
                    finalTranscript += transcript;
                } else {
                    interimTranscript += transcript;
                }
            }
            
            if (interimTranscript) {
                updateStreamingMessage(interimTranscript, 'user');
            }
            
            if (finalTranscript) {
                console.log('Final transcript:', finalTranscript);
                
                if (currentStreamingMessage) {
                    currentStreamingMessage.remove();
                    currentStreamingMessage = null;
                }
                
                addMessage('user', finalTranscript);
                updateWordCount(finalTranscript);
                
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({
                        type: 'answer',
                        text: finalTranscript,
                        wordCount: finalTranscript.split(' ').length
                    }));
                }
                
                // Stop timer when answer is received
                stopQuestionTimer();
                
                if (isRecording) {
                    isRecording = false;
                    recordBtn.classList.remove('record');
                }
            }
        };
        
        recognition.onerror = function(event) {
            console.error('Speech recognition error:', event.error);
            
            if (event.error === 'no-speech') {
                return;
            }
            
            let errorMessage = '';
            switch(event.error) {
                case 'audio-capture':
                    errorMessage = 'No microphone found.';
                    break;
                case 'not-allowed':
                    errorMessage = 'Microphone access denied.';
                    break;
                case 'network':
                    errorMessage = 'Network error. Using text mode.';
                    setupFallbackMode();
                    break;
                default:
                    errorMessage = `Speech error: ${event.error}`;
            }
            
            if (errorMessage) {
                showNotification(`❌ ${errorMessage}`, 'error');
            }
            
            updateAvatarStatus('idle');
            isRecording = false;
            recordBtn.classList.remove('record');
        };
        
        recognition.onend = function() {
            console.log('Speech recognition ended');
            
            if (isRecording && isInterviewActive && !manualStop) {
                try {
                    recognition.start();
                } catch (e) {
                    console.log('Restart failed:', e);
                }
            } else {
                updateAvatarStatus('idle');
                manualStop = false;
            }
        };
        
        return true;
        
    } catch (e) {
        console.error('Failed to initialize speech recognition:', e);
        showNotification('Speech recognition failed. Using text mode.', 'warning');
        setupFallbackMode();
        return false;
    }
}

// ========== FALLBACK MODE ==========
function setupFallbackMode() {
    usingFallback = true;
    showNotification('✏️ Using text input mode. Please type your answers.', 'info');
    
    userInput.disabled = false;
    userInput.placeholder = 'Type your answer here...';
    sendBtn.disabled = false;
    
    recordBtn.disabled = true;
    recordBtn.style.opacity = '0.5';
    recordBtn.title = 'Speech unavailable - using text mode';
}

// ========== CAMERA SETUP ==========
async function initCamera() {
    try {
        const constraints = {
            video: true,
            audio: true
        };
        
        mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
        studentVideo.srcObject = mediaStream;
        videoPlaceholder.style.display = 'none';
        recordingIndicator.style.display = 'flex';
        isVideoOn = true;
        videoBtn.style.background = 'rgba(102, 126, 234, 0.9)';
        console.log('✅ Camera and microphone initialized');
        showNotification('📹 Camera and microphone ready', 'success', 2000);
        
    } catch (err) {
        console.error('Camera error:', err);
        videoPlaceholder.textContent = 'Camera access denied';
        videoPlaceholder.style.display = 'block';
        recordingIndicator.style.display = 'none';
        isVideoOn = false;
        videoBtn.style.background = '#6c757d';
        
        try {
            const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            console.log('✅ Microphone initialized (camera disabled)');
            showNotification('🎤 Microphone ready (camera disabled)', 'info', 2000);
        } catch (audioErr) {
            console.error('Microphone error:', audioErr);
            showNotification('❌ Microphone access denied. You can type answers.', 'error');
        }
    }
}

// ========== WEBSOCKET CONNECTION ==========
function connectWebSocket() {
    connectionText.textContent = 'Connecting to Sophia...';
    
    ws = new WebSocket(`ws://localhost:8000/ws/${sessionId}`);
    
    ws.onopen = function() {
        console.log('✅ WebSocket connected');
        isConnected = true;
        connectionDot.classList.add('connected');
        connectionText.textContent = 'Connected to Sophia';
        reconnectAttempts = 0;
        
        showNotification('✅ Connected to Sophia', 'success', 2000);
        
        setInterval(() => {
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'ping' }));
            }
        }, 30000);
        
        setTimeout(() => {
            startPrompt.classList.add('show');
        }, 1000);
    };
    
    ws.onmessage = function(event) {
        const data = JSON.parse(event.data);
        console.log('Received:', data.type);
        handleInterviewMessage(data);
    };
    
    ws.onerror = function(error) {
        console.error('WebSocket error:', error);
        connectionText.textContent = 'Connection error';
        connectionDot.classList.remove('connected');
        showNotification('❌ Cannot connect to server', 'error');
        
        if (reconnectAttempts < maxReconnectAttempts) {
            reconnectAttempts++;
            connectionText.textContent = `Reconnecting (${reconnectAttempts}/${maxReconnectAttempts})...`;
            setTimeout(connectWebSocket, 3000);
        }
    };
    
    ws.onclose = function() {
        console.log('WebSocket closed');
        isConnected = false;
        connectionDot.classList.remove('connected');
        connectionText.textContent = 'Disconnected';
        showNotification('Disconnected from server', 'warning');
        disableControls();
    };
}

// ========== HANDLE MESSAGES FROM AI ==========
function handleInterviewMessage(data) {
    switch(data.type) {
        case 'connected':
            showNotification(data.message, 'info', 2000);
            break;
            
        case 'welcome':
            streamAIMessage(data.message, 'ai');
            speakText(data.message, false);
            isInterviewActive = true;
            enableControls();
            showNotification('🎤 Interview started!', 'success', 2000);
            break;
            
        case 'question':
            currentQuestion.textContent = `"${data.question}"`;
            const questionText = `Question ${data.question_number}: ${data.question}`;
            streamAIMessage(questionText, 'ai');
            speakText(data.question, true);
            updateAvatarStatus('speaking');
            
            // Reset and start timer for new question
            resetQuestionTimer();
            startQuestionTimer(60);
            break;
            
        case 'feedback':
            streamAIMessage(data.feedback, 'ai');
            speakText(data.feedback, false);
            updateAvatarStatus('listening');
            
            // Stop timer when answer is processed
            stopQuestionTimer();
            break;
            
        case 'encouragement':
            streamAIMessage(data.message, 'ai');
            speakText(data.message, false);
            break;
            
        case 'completed':
            streamAIMessage(`🎉 ${data.message}`, 'ai');
            speakText(data.message, false);
            if (data.summary) {
                streamAIMessage(`Summary: ${data.summary.total_questions} questions answered`, 'ai');
            }
            isInterviewActive = false;
            isRecording = false;
            
            // Stop timer
            stopQuestionTimer();
            
            if (recognition) {
                try { recognition.stop(); } catch (e) {}
            }
            recordBtn.classList.remove('record');
            disableControls();
            showNotification('✅ Interview completed! Great job!', 'success', 5000);
            break;
            
        case 'pong':
            console.log('Connection alive');
            break;
            
        case 'error':
            showNotification(`❌ ${data.message}`, 'error');
            break;
    }
}

// ========== STREAM AI MESSAGE ==========
function streamAIMessage(text, sender) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${sender} streaming`;
    
    const senderDiv = document.createElement('div');
    senderDiv.className = 'sender';
    senderDiv.textContent = sender === 'ai' ? 'Sophia' : 'System';
    
    const contentDiv = document.createElement('div');
    contentDiv.className = 'content';
    
    const timeDiv = document.createElement('div');
    timeDiv.className = 'time';
    
    messageDiv.appendChild(senderDiv);
    messageDiv.appendChild(contentDiv);
    messageDiv.appendChild(timeDiv);
    
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    
    let i = 0;
    const interval = setInterval(() => {
        if (i < text.length) {
            contentDiv.textContent += text[i];
            chatMessages.scrollTop = chatMessages.scrollHeight;
            i++;
        } else {
            clearInterval(interval);
            messageDiv.classList.remove('streaming');
            timeDiv.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }
    }, 30);
}

// ========== UPDATE STREAMING MESSAGE ==========
function updateStreamingMessage(text, sender) {
    if (!currentStreamingMessage) {
        currentStreamingMessage = document.createElement('div');
        currentStreamingMessage.className = `message ${sender} streaming`;
        
        const senderDiv = document.createElement('div');
        senderDiv.className = 'sender';
        senderDiv.textContent = sender === 'user' ? 'You' : 'System';
        
        const contentDiv = document.createElement('div');
        contentDiv.className = 'content';
        
        currentStreamingMessage.appendChild(senderDiv);
        currentStreamingMessage.appendChild(contentDiv);
        
        chatMessages.appendChild(currentStreamingMessage);
    }
    
    const contentDiv = currentStreamingMessage.querySelector('.content');
    contentDiv.textContent = text;
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// ========== ADD MESSAGE ==========
function addMessage(sender, text) {
    if (sender === 'user' && currentStreamingMessage) {
        currentStreamingMessage.remove();
        currentStreamingMessage = null;
    }
    
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${sender}`;
    
    const senderDiv = document.createElement('div');
    senderDiv.className = 'sender';
    senderDiv.textContent = sender === 'ai' ? 'Sophia' : sender === 'user' ? 'You' : 'System';
    
    const contentDiv = document.createElement('div');
    contentDiv.className = 'content';
    contentDiv.textContent = text;
    
    const timeDiv = document.createElement('div');
    timeDiv.className = 'time';
    timeDiv.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    messageDiv.appendChild(senderDiv);
    messageDiv.appendChild(contentDiv);
    messageDiv.appendChild(timeDiv);
    
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// ========== UPDATE AVATAR STATUS ==========
function updateAvatarStatus(status) {
    avatarCircle.classList.remove('speaking', 'listening');
    
    switch(status) {
        case 'speaking':
            avatarCircle.classList.add('speaking');
            aiStatus.textContent = 'Speaking...';
            speakingIndicator.style.display = 'flex';
            break;
        case 'listening':
            avatarCircle.classList.add('listening');
            aiStatus.textContent = 'Listening...';
            speakingIndicator.style.display = 'none';
            break;
        default:
            aiStatus.textContent = 'Ready';
            speakingIndicator.style.display = 'none';
    }
}

// ========== UPDATE WORD COUNT ==========
function updateWordCount(text) {
    const words = text.trim().split(/\s+/).filter(w => w.length > 0).length;
    wordCount.textContent = words;
}

// ========== UPDATE COUNTDOWN ==========
function updateCountdown() {
    if (countdown > 0 && isInterviewActive) {
        countdown--;
        const minutes = Math.floor(countdown / 60);
        const seconds = countdown % 60;
        countdownTimer.textContent = `COUNTDOWN: ${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }
}

// ========== ENABLE CONTROLS ==========
function enableControls() {
    if (!usingFallback) {
        userInput.disabled = false;
        sendBtn.disabled = false;
        recordBtn.disabled = false;
    } else {
        userInput.disabled = false;
        sendBtn.disabled = false;
        recordBtn.disabled = true;
    }
    micBtn.disabled = false;
    endBtn.disabled = false;
}

// ========== DISABLE CONTROLS ==========
function disableControls() {
    userInput.disabled = true;
    sendBtn.disabled = true;
    recordBtn.disabled = true;
    micBtn.disabled = true;
    endBtn.disabled = true;
}

// ========== TEST SERVER ==========
async function testServerConnection() {
    try {
        const response = await fetch('http://localhost:8000/test');
        if (response.ok) {
            const data = await response.json();
            console.log('✅ Server test:', data);
            return true;
        }
    } catch (error) {
        console.error('❌ Server test failed:', error);
    }
    return false;
}

// ========== INITIALIZE ==========
document.addEventListener('DOMContentLoaded', async function() {
    console.log('Page loaded, initializing...');
    
    const speechAvailable = initSpeechRecognition();
    if (!speechAvailable) {
        setupFallbackMode();
    }
    
    const serverReachable = await testServerConnection();
    if (!serverReachable) {
        showNotification('⚠️ Cannot reach server. Make sure backend is running on port 8000', 'error');
        connectionText.textContent = 'Server offline';
        return;
    }
    
    await initCamera();
    connectWebSocket();
    setInterval(updateCountdown, 1000);
    
    // ========== EVENT LISTENERS ==========
    
    startInterviewBtn.addEventListener('click', function() {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'start_interview' }));
            startPrompt.classList.remove('show');
        } else {
            showNotification('❌ Not connected to server', 'error');
            alert('Not connected to server');
        }
    });
    
    recordBtn.addEventListener('click', function() {
        if (!isInterviewActive) {
            showNotification('⚠️ Start the interview first', 'warning');
            return;
        }
        
        if (usingFallback) {
            showNotification('✏️ Speech not available - type your answer', 'info');
            userInput.focus();
            return;
        }
        
        manualStop = false;
        isRecording = !isRecording;
        
        if (isRecording) {
            this.classList.add('record');
            if (recognition) {
                try {
                    recognition.start();
                    showNotification('🎤 Recording started - speak naturally', 'info', 2000);
                } catch (e) {
                    console.log('Recognition error:', e);
                }
            }
        } else {
            this.classList.remove('record');
            if (recognition) {
                manualStop = true;
                try { recognition.stop(); } catch (e) {}
                showNotification('⏸ Recording paused', 'info', 2000);
            }
        }
    });
    
    micBtn.addEventListener('click', function() {
        if (!isInterviewActive) return;
        
        isMicOn = !isMicOn;
        this.style.background = isMicOn ? 'rgba(102, 126, 234, 0.9)' : '#dc3545';
        showNotification(isMicOn ? '🎤 Microphone on' : '🎤 Microphone off', 'info', 1500);
    });
    
    videoBtn.addEventListener('click', function() {
        isVideoOn = !isVideoOn;
        this.style.background = isVideoOn ? 'rgba(102, 126, 234, 0.9)' : '#6c757d';
        
        if (mediaStream) {
            mediaStream.getVideoTracks().forEach(track => track.enabled = isVideoOn);
        }
        
        videoPlaceholder.style.display = isVideoOn ? 'none' : 'block';
        recordingIndicator.style.display = isVideoOn ? 'flex' : 'none';
        showNotification(isVideoOn ? '📹 Camera on' : '📹 Camera off', 'info', 1500);
    });
    
    sendBtn.addEventListener('click', function() {
        if (!isInterviewActive) {
            showNotification('⚠️ Start the interview first', 'warning');
            return;
        }
        
        const text = userInput.value.trim();
        if (text) {
            addMessage('user', text);
            updateWordCount(text);
            
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'answer',
                    text: text,
                    wordCount: text.split(' ').length
                }));
            }
            
            userInput.value = '';
            
            // Stop timer when answer is sent
            stopQuestionTimer();
        }
    });
    
    userInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            sendBtn.click();
        }
    });
    
    endBtn.addEventListener('click', function() {
        if (confirm('End the interview?')) {
            isRecording = false;
            isInterviewActive = false;
            
            // Stop timer
            stopQuestionTimer();
            
            if (recognition) {
                try { recognition.stop(); } catch (e) {}
            }
            if (synthesis) {
                synthesis.cancel();
            }
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'end_interview' }));
                setTimeout(() => { ws.close(); }, 1000);
            }
            showNotification('👋 Interview ended', 'info');
            recordBtn.classList.remove('record');
            disableControls();
        }
    });
});

// ========== CLEANUP ==========
window.addEventListener('beforeunload', function() {
    if (ws) { ws.close(); }
    if (mediaStream) {
        mediaStream.getTracks().forEach(track => track.stop());
    }
    if (synthesis) { synthesis.cancel(); }
    if (questionTimer) {
        clearInterval(questionTimer);
    }
});