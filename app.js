// NineHack Web App - 1:1 Port of Android App (NineHack 1.2 huxvie mod)
// Built for Safari / Bluefy Web Bluetooth on iOS

// BLE Constants (from com.timeylies.ninehack.controlActivity)
const UART_SERVICE = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const UART_TX_CHAR = '6e400003-b5a3-f393-e0a9-e50e24dcca9e'; // Notifications from scooter
const UART_RX_CHAR = '6e400002-b5a3-f393-e0a9-e50e24dcca9e'; // Write commands to scooter

// Command bytes (from com.timeylies.ninehack.CommandCreator)
// Java: {1, Ascii.DLE (16/0x10), 5 (0x05), Ascii.NAK (21/0x15), 97 (0x61), -127 (0x81)}
const COMMAND_BYTES = [0x01, 0x10, 0x05, 0x15, 0x61, 0x81];
const HEADER = [0xA3, 0xA4];

// Global state variables
let bluetoothDevice = null;
let bluetoothServer = null;
let bluetoothService = null;
let txCharacteristic = null;
let rxCharacteristic = null;
let actualKey = 0;
let bleKey = '4BKNwi77';
let isAuthenticated = false;
let isAutoTryingKeys = false;
let currentKeyIndex = 0;

// Universal BLE Keys list (as convenience helper)
const BLE_KEYS = [
    '4BKNwi77', // Default key in NineHack 1.2
    'Ulb8omSq',
    '9wYGaWn6',
    'S9oqBJM0',
    '7kMpXqR2',
    'JtN5wAeL',
    'bYz9DgH1',
    'PqV6rSfM',
    '3nWjCtQ0',
    'ZxR8uBkL'
];

// Screen navigation
function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(screen => {
        screen.classList.remove('active');
    });
    const target = document.getElementById(screenId);
    if (target) target.classList.add('active');
}

// UI Event Listeners Initialization
if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', () => {
        // Check if Bluefy / Web Bluetooth is available
        if (!navigator.bluetooth) {
            showBluefyWarning();
        }

        // Main screen buttons
        document.getElementById('start-btn').addEventListener('click', () => {
            showScreen('scan-screen');
        });
        document.getElementById('settings-btn').addEventListener('click', () => {
            showScreen('settings-screen');
        });
        
        // Settings screen buttons
        document.getElementById('settings-back-btn').addEventListener('click', () => {
            showScreen('main-screen');
        });
        document.getElementById('save-ble-key-btn').addEventListener('click', saveBleKey);
        
        // Scan screen buttons
        document.getElementById('scan-back-btn').addEventListener('click', () => {
            showScreen('main-screen');
        });
        document.getElementById('scan-btn').addEventListener('click', scanForDevices);
        
        // Control screen buttons
        document.getElementById('control-back-btn').addEventListener('click', disconnectAndGoBack);
        
        // Tab navigation
        document.querySelectorAll('.tab').forEach(tab => {
            tab.addEventListener('click', () => switchTab(tab.dataset.tab));
        });
        
        // Control buttons (Tab 1: Basic)
        document.getElementById('unlock-btn').addEventListener('click', sendUnlockCommand);
        document.getElementById('lock-btn').addEventListener('click', sendLockCommand);
        document.getElementById('send-to-scooter-btn').addEventListener('click', sendSetScooterCommand);
        document.getElementById('eject-battery-btn').addEventListener('click', sendEjectBatteryCommand);
        document.getElementById('auto-key-btn').addEventListener('click', startAutoKeyScan);
        
        // Load saved BLE key from localStorage
        const savedKey = localStorage.getItem('ble_key');
        if (savedKey) {
            bleKey = savedKey;
            const keyInput = document.getElementById('ble-key-input');
            if (keyInput) keyInput.value = savedKey;
        }
        
        // Initial UI state
        disableControls();
    });
}

function showBluefyWarning() {
    const warning = document.createElement('div');
    warning.className = 'bluefy-alert';
    warning.innerHTML = `
        <div class="alert-icon">⚠️</div>
        <div class="alert-content">
            <strong>Web Bluetooth Not Found!</strong><br>
            If you are on an iPhone / iPad, please open this website inside the 
            <a href="https://apps.apple.com/app/bluefy-web-ble-browser/id1492822055" target="_blank">Bluefy App</a> 
            to enable Bluetooth!
        </div>
    `;
    document.body.insertBefore(warning, document.body.firstChild);
}

// Tab switching logic
function switchTab(tabId) {
    document.querySelectorAll('.tab').forEach(tab => {
        tab.classList.remove('active');
    });
    document.querySelectorAll('.tab-pane').forEach(pane => {
        pane.classList.remove('active');
    });
    
    const activeTab = document.querySelector(`[data-tab="${tabId}"]`);
    const activePane = document.getElementById(tabId);
    if (activeTab) activeTab.classList.add('active');
    if (activePane) activePane.classList.add('active');
}

// BLE Key management
function saveBleKey() {
    const inputKey = document.getElementById('ble-key-input').value.trim();
    if (inputKey.length > 0) {
        bleKey = inputKey;
        localStorage.setItem('ble_key', bleKey);
        showToast('BLE Key saved!');
        showScreen('main-screen');
    } else {
        bleKey = '4BKNwi77';
        localStorage.setItem('ble_key', bleKey);
        document.getElementById('ble-key-input').value = bleKey;
        showToast('Reset to default key: 4BKNwi77');
        showScreen('main-screen');
    }
}

// Connection Log management
function addLog(message, type = 'normal') {
    const logContent = document.getElementById('log-content');
    if (!logContent) return;
    
    const logEntry = document.createElement('div');
    logEntry.className = `log-entry ${type}`;
    logEntry.textContent = message;
    logContent.appendChild(logEntry);
    logContent.scrollTop = logContent.scrollHeight;
}

function clearLog() {
    const logContent = document.getElementById('log-content');
    if (logContent) logContent.innerHTML = '';
}

// Toast notification helper
function showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    
    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// CRC-8 Implementation (1:1 parity with com.timeylies.ninehack.Crc8)
class Crc8 {
    constructor() {
        this.crcTable = [
            0, 49, 98, 83, 196, 245, 166, 151, 185, 136, 219, 234, 125, 76, 31, 46,
            67, 114, 33, 16, 131, 182, 229, 212, 250, 203, 152, 169, 62, 15, 92, 109,
            197, 244, 228, 213, 66, 115, 32, 17, 63, 14, 93, 108, 251, 202, 153, 168,
            184, 137, 218, 235, 124, 77, 30, 47, 1, 48, 99, 82, 195, 246, 165, 150,
            61, 12, 95, 110, 249, 200, 155, 170, 186, 139, 216, 233, 126, 79, 28, 45,
            122, 75, 24, 41, 187, 138, 217, 232, 59, 10, 89, 104, 254, 207, 156, 173,
            60, 13, 94, 111, 248, 201, 154, 171, 185, 138, 217, 232, 127, 78, 29, 44,
            2, 51, 96, 81, 194, 247, 164, 149, 248, 201, 154, 171, 60, 13, 94, 111,
            65, 112, 35, 18, 129, 176, 231, 214, 122, 75, 24, 41, 187, 138, 217, 232,
            143, 190, 221, 236, 123, 74, 25, 40, 6, 55, 100, 85, 198, 243, 164, 149,
            57, 8, 91, 106, 253, 204, 159, 174, 128, 177, 226, 211, 68, 117, 38, 23,
            252, 205, 158, 175, 56, 9, 90, 107, 69, 116, 39, 22, 129, 176, 227, 210,
            191, 142, 221, 236, 123, 74, 25, 40, 6, 55, 100, 85, 193, 242, 167, 150,
            71, 118, 37, 20, 133, 180, 225, 208, 254, 207, 156, 173, 58, 11, 88, 105,
            4, 53, 102, 87, 192, 241, 168, 147, 189, 140, 223, 238, 121, 72, 27, 42,
            195, 242, 167, 150, 5, 52, 101, 86, 197, 244, 165, 148, 73, 120, 27, 42,
            190, 143, 222, 239, 130, 179, 224, 209, 70, 119, 36, 21, 59, 10, 89, 104,
            255, 206, 157, 172
        ];
    }
    
    reflect8(val) {
        let resByte = 0;
        for (let i = 0; i < 8; i++) {
            if ((val & (1 << i)) !== 0) {
                resByte |= 1 << (7 - i);
            }
        }
        return resByte;
    }
    
    compute(bytes) {
        let crc = 0;
        for (let b of bytes) {
            const curByte = this.reflect8(b & 0xFF);
            const data = (curByte ^ crc) & 0xFF;
            crc = this.crcTable[data];
        }
        return (this.reflect8(crc) ^ 0) & 0xFF;
    }
}

const crc8 = new Crc8();

// Command Builder (1:1 parity with com.timeylies.ninehack.CommandCreator)
function buildCommand(originalCmd, originalData, useAuthKey = false) {
    const originalRand = Math.floor(Math.random() * 254) + 1;
    const rand = (originalRand + 50) & 0xFF;
    
    let key, cmd, data;
    
    if (useAuthKey) {
        // GetKey command: key = 0 ^ originalRand, cmd = commandBytes[0] ^ originalRand
        key = (0 ^ originalRand) & 0xFF;
        cmd = (originalCmd ^ originalRand) & 0xFF;
        data = [];
        for (let i = 0; i < bleKey.length; i++) {
            data.push((bleKey.charCodeAt(i) ^ originalRand) & 0xFF);
        }
    } else {
        // Other commands: key = actualKey ^ originalRand, cmd = originalCmd ^ originalRand
        key = (actualKey ^ originalRand) & 0xFF;
        cmd = (originalCmd ^ originalRand) & 0xFF;
        data = originalData.map(b => (b ^ originalRand) & 0xFF);
    }
    
    const length = data.length & 0xFF;
    const packet = [...HEADER, length, rand, key, cmd, ...data];
    const crc = crc8.compute(packet) & 0xFF;
    
    return new Uint8Array([...packet, crc]);
}

// BLE Commands generators
function getKeyCommand(keyString) {
    bleKey = keyString || bleKey;
    return buildCommand(COMMAND_BYTES[0], null, true);
}

function getUnlockCommand() {
    return buildCommand(COMMAND_BYTES[2], [1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
}

function getLockCommand() {
    return buildCommand(COMMAND_BYTES[3], [1]);
}

function getSetScooterCommand(headlight, mode, throttle) {
    return buildCommand(COMMAND_BYTES[4], [headlight, mode, throttle, 0]);
}

function getEjectBatteryCommand() {
    return buildCommand(COMMAND_BYTES[5], [5]);
}

// Web Bluetooth Scanning & Connection
async function scanForDevices() {
    if (!navigator.bluetooth) {
        showToast('Bluetooth not supported in this browser! Use Bluefy on iOS.');
        return;
    }
    
    const scanBtn = document.getElementById('scan-btn');
    scanBtn.textContent = 'Scanning...';
    scanBtn.classList.add('scanning');
    scanBtn.disabled = true;
    
    try {
        addLog('Requesting Bluetooth device...');
        
        // Request device with UART service filter or fallback to acceptAllDevices
        try {
            bluetoothDevice = await navigator.bluetooth.requestDevice({
                filters: [{ services: [UART_SERVICE] }],
                optionalServices: [UART_SERVICE]
            });
        } catch (e) {
            // Fallback for devices broadcasting non-standard GATT advertisements
            bluetoothDevice = await navigator.bluetooth.requestDevice({
                acceptAllDevices: true,
                optionalServices: [UART_SERVICE]
            });
        }
        
        addLog(`Device selected: ${bluetoothDevice.name || 'Unknown Device'} (${bluetoothDevice.id || 'N/A'})`);
        
        bluetoothDevice.addEventListener('gattserverdisconnected', onDisconnected);
        
        await connectToDevice();
        
    } catch (error) {
        if (error.name !== 'NotFoundError') { // User didn't just cancel picker
            addLog(`Scan Error: ${error.message}`, 'error');
            showToast('Scan or connection failed');
        } else {
            addLog('Device selection cancelled.', 'info');
        }
    } finally {
        scanBtn.textContent = 'Scan';
        scanBtn.classList.remove('scanning');
        scanBtn.disabled = false;
    }
}

async function connectToDevice() {
    try {
        addLog('Connecting to GATT server...');
        updateConnectionBadge('connecting', 'Connecting...');
        
        bluetoothServer = await bluetoothDevice.gatt.connect();
        addLog('Connected!');
        
        addLog('Discovering Services...');
        bluetoothService = await bluetoothServer.getPrimaryService(UART_SERVICE);
        addLog('Services Discovered!');
        
        addLog('Getting Characteristics...');
        txCharacteristic = await bluetoothService.getCharacteristic(UART_TX_CHAR);
        rxCharacteristic = await bluetoothService.getCharacteristic(UART_RX_CHAR);
        
        addLog('Enabling Notifications...');
        await txCharacteristic.startNotifications();
        txCharacteristic.addEventListener('characteristicvaluechanged', handleNotification);
        addLog('Successfully enabled Notifications');
        
        showScreen('control-screen');
        clearLog();
        addLog('Connected to: ' + (bluetoothDevice.name || bluetoothDevice.id));
        addLog('Enabling Notifications...');
        addLog('Successfully enabled Notifications');
        
        // Send initial GetKey authentication command
        await sendFirstStageAuth();
        
    } catch (error) {
        addLog(`Connection error: ${error.message}`, 'error');
        updateConnectionBadge('disconnected', 'Disconnected');
        showToast('App was not able to connect');
        throw error;
    }
}

function onDisconnected() {
    addLog('Disconnected', 'error');
    updateConnectionBadge('disconnected', 'Disconnected');
    isAuthenticated = false;
    isAutoTryingKeys = false;
    disableControls();
}

async function sendFirstStageAuth() {
    addLog('Trying to write GetKey Command...');
    try {
        const authCommand = getKeyCommand(bleKey);
        await rxCharacteristic.writeValue(authCommand);
        addLog('Writing Command...');
        addLog('Successfully Wrote to Characteristic');
    } catch (error) {
        addLog(`Couldn't write command! Error: ${error.message}`, 'error');
    }
}

// Web Bluetooth notification handler
function handleNotification(event) {
    const dataView = event.target.value; // event.target.value is a DataView!
    if (!dataView) return;
    
    // Correctly convert DataView to Uint8Array using buffer & offsets
    const bytes = new Uint8Array(dataView.buffer, dataView.byteOffset, dataView.byteLength);
    
    addLog(`Got Message: ${bytesToHex(bytes)}`, 'info');
    
    // Header check: 0xA3 (-93), 0xA4 (-92)
    if (bytes.length >= 6 && bytes[0] === 0xA3 && bytes[1] === 0xA4) {
        const length = bytes[2];
        const rand = (bytes[3] - 50) & 0xFF;
        const cmd = (bytes[5] ^ rand) & 0xFF;
        
        const data = [];
        for (let i = 0; i < length && (6 + i) < bytes.length; i++) {
            data.push((bytes[6 + i] ^ rand) & 0xFF);
        }
        
        processResponse(cmd, data);
    }
}

// Decode scooter response packets (1:1 with CommandCreator.decodeMessage)
function processResponse(cmd, data) {
    switch (cmd) {
        case COMMAND_BYTES[0]: // Authentication response (0x01)
            if (data[0] === 1) {
                actualKey = data[1];
                isAuthenticated = true;
                isAutoTryingKeys = false;
                
                addLog('Key is Correct!', 'success');
                addLog(`Key: 0x${actualKey.toString(16).toUpperCase().padStart(2, '0')}`, 'success');
                updateConnectionBadge('connected', 'Authenticated');
                
                // Save working key
                localStorage.setItem('ble_key', bleKey);
                enableControls();
            } else {
                addLog('Uh oh, key is incorrect!', 'error');
                addLog('Try another key by changing it in the main screen!', 'error');
                
                if (isAutoTryingKeys) {
                    currentKeyIndex++;
                    tryNextAutoKey();
                } else {
                    updateConnectionBadge('error', 'Auth Failed');
                    showToast('Uh oh, key is incorrect!');
                }
            }
            break;
            
        case COMMAND_BYTES[1]: // Error response (0x10)
            addLog('Uh oh, we got an error from the scooter!', 'error');
            if (data[0] === 1) {
                addLog('BUG! CRC Bad!', 'error');
            }
            break;
            
        case COMMAND_BYTES[2]: // Unlock response (0x05)
            if (data[0] === 1) {
                addLog('Scooter Unlocked Successfully!', 'success');
                showToast('Scooter Unlocked Successfully!');
            } else {
                addLog('Scooter Unlock Failed!', 'error');
                showToast('Scooter Unlock Failed!');
            }
            break;
            
        case COMMAND_BYTES[3]: // Lock response (0x15)
            if (data[0] === 1) {
                addLog('Scooter Locked Successfully!', 'success');
                showToast('Scooter Locked Successfully!');
            } else {
                addLog('Scooter Lock Failed!', 'error');
                showToast('Scooter Lock Failed!');
            }
            break;
            
        case COMMAND_BYTES[4]: // Set scooter response (0x61)
            if (data[0] === 0) {
                addLog('Scooter Set Successfully!', 'success');
                showToast('Scooter Set Successfully!');
            } else {
                addLog('Scooter Set Failed!', 'error');
                showToast('Scooter Set Failed!');
            }
            break;
            
        case COMMAND_BYTES[5]: // Eject battery response (0x81)
            if (data[0] === 1) {
                addLog('Scooter Battery Ejected Successfully!', 'success');
                showToast('Battery Ejected Successfully!');
            } else {
                addLog('Scooter Battery Eject Failed!', 'error');
                showToast('Battery Eject Failed!');
            }
            break;
            
        default:
            addLog(`Got unknown command: 0x${cmd.toString(16).toUpperCase()}`, 'info');
    }
}

// Scooter Actions (Tab 1: Basic)
async function sendUnlockCommand() {
    if (!isAuthenticated) {
        showToast('Please authenticate first');
        return;
    }
    try {
        addLog('Sending Unlock...');
        const command = getUnlockCommand();
        await rxCharacteristic.writeValue(command);
        addLog('Writing Command...');
    } catch (error) {
        addLog(`Error sending Unlock: ${error.message}`, 'error');
    }
}

async function sendLockCommand() {
    if (!isAuthenticated) {
        showToast('Please authenticate first');
        return;
    }
    try {
        addLog('Sending Lock...');
        const command = getLockCommand();
        await rxCharacteristic.writeValue(command);
        addLog('Writing Command...');
    } catch (error) {
        addLog(`Error sending Lock: ${error.message}`, 'error');
    }
}

async function sendSetScooterCommand() {
    if (!isAuthenticated) {
        showToast('Please authenticate first');
        return;
    }
    
    // Get mode from selected radio button (1, 2, or 3)
    const modeEl = document.querySelector('input[name="mode"]:checked');
    const mode = modeEl ? parseInt(modeEl.value) : 3;
    
    // Get headlight & throttle switches (1 = off/normal, 2 = on/enabled)
    const headlightChecked = document.getElementById('headlight-switch').checked;
    const throttleChecked = document.getElementById('throttle-switch').checked;
    
    const headlight = headlightChecked ? 2 : 1;
    const throttle = throttleChecked ? 2 : 1;
    
    try {
        addLog(`Sending Settings: Mode ${mode}, Headlight ${headlightChecked ? 'ON' : 'OFF'}, Throttle ${throttleChecked ? 'ON' : 'OFF'}`);
        const command = getSetScooterCommand(headlight, mode, throttle);
        await rxCharacteristic.writeValue(command);
        addLog('Writing Command...');
    } catch (error) {
        addLog(`Error sending settings: ${error.message}`, 'error');
    }
}

async function sendEjectBatteryCommand() {
    if (!isAuthenticated) {
        showToast('Please authenticate first');
        return;
    }
    try {
        addLog('Sending Eject Battery...');
        const command = getEjectBatteryCommand();
        await rxCharacteristic.writeValue(command);
        addLog('Writing Command...');
    } catch (error) {
        addLog(`Error ejecting battery: ${error.message}`, 'error');
    }
}

// Auto Key scanner helper
async function startAutoKeyScan() {
    if (!rxCharacteristic) {
        showToast('Not connected to device');
        return;
    }
    
    addLog('Starting Auto BLE Key scan...');
    isAutoTryingKeys = true;
    currentKeyIndex = 0;
    await tryNextAutoKey();
}

async function tryNextAutoKey() {
    if (currentKeyIndex >= BLE_KEYS.length) {
        addLog('All universal keys failed.', 'error');
        isAutoTryingKeys = false;
        showToast('All universal keys failed');
        return;
    }
    
    const keyToTry = BLE_KEYS[currentKeyIndex];
    bleKey = keyToTry;
    addLog(`Testing key ${currentKeyIndex + 1}/${BLE_KEYS.length}: ${keyToTry}`);
    
    try {
        const authCommand = getKeyCommand(keyToTry);
        await rxCharacteristic.writeValue(authCommand);
    } catch (error) {
        addLog(`Error trying key ${keyToTry}: ${error.message}`, 'error');
        currentKeyIndex++;
        setTimeout(tryNextAutoKey, 500);
    }
}

// Controls Enable/Disable (Parity with controlActivity.controlTabs)
function enableControls() {
    document.querySelectorAll('.btn-action, .btn-danger, #send-to-scooter-btn').forEach(btn => {
        btn.disabled = false;
    });
}

function disableControls() {
    document.querySelectorAll('.btn-action, .btn-danger, #send-to-scooter-btn').forEach(btn => {
        btn.disabled = true;
    });
}

function disconnectAndGoBack() {
    if (bluetoothDevice && bluetoothDevice.gatt && bluetoothDevice.gatt.connected) {
        bluetoothDevice.gatt.disconnect();
    }
    isAuthenticated = false;
    isAutoTryingKeys = false;
    disableControls();
    updateConnectionBadge('disconnected', 'Disconnected');
    showScreen('main-screen');
}

// Connection badge status indicator
function updateConnectionBadge(statusClass, text) {
    const badge = document.getElementById('status-badge');
    if (badge) {
        badge.className = `status-badge ${statusClass}`;
        badge.textContent = text;
    }
}

// Hex formatter helper
function bytesToHex(bytes) {
    return Array.from(bytes)
        .map(b => b.toString(16).padStart(2, '0').toUpperCase())
        .join(' ');
}