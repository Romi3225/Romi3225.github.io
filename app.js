// NineHack Web App - 1:1 Port of Android App (NineHack 1.2 huxvie mod)
// Built for Safari / Bluefy Web Bluetooth on iOS

// BLE Constants (from com.timeylies.ninehack.controlActivity)
const UART_SERVICE = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const UART_TX_CHAR = '6e400003-b5a3-f393-e0a9-e50e24dcca9e'; // Notifications from scooter
const UART_RX_CHAR = '6e400002-b5a3-f393-e0a9-e50e24dcca9e'; // Write commands to scooter

// Command bytes (from com.timeylies.ninehack.CommandCreator)
// Java: static byte[] commandBytes = {1, Ascii.DLE, 5, Ascii.NAK, 97, -127};
// Ascii.DLE = 16 (0x10), Ascii.NAK = 21 (0x15), 97 = 0x61, -127 as signed byte = 0x81
const COMMAND_BYTES = [0x01, 0x10, 0x05, 0x15, 0x61, 0x81];

// Header bytes: Java Header = {-93, -92} → as unsigned bytes = {0xA3, 0xA4}
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

// Universal BLE Keys list
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
            <strong>Web Bluetooth nicht gefunden!</strong><br>
            Öffne diese Seite in der <a href="https://apps.apple.com/app/bluefy-web-ble-browser/id1492822055" target="_blank">Bluefy App</a> auf dem iPhone, um Bluetooth zu nutzen!
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
        showToast('BLE Key gespeichert!');
        showScreen('main-screen');
    } else {
        bleKey = '4BKNwi77';
        localStorage.setItem('ble_key', bleKey);
        document.getElementById('ble-key-input').value = bleKey;
        showToast('Standard-Key wiederhergestellt: 4BKNwi77');
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

// ============================================================
// CRC-8 Implementation
// Exactly matches com.timeylies.ninehack.Crc8:
//   - poly=0x31, non-reflected table generated by standard shift method
//   - reflect8() applied to each input byte BEFORE table lookup
//   - reflect8() applied to final crc result
// This is CRC-8/MAXIM (poly=0x31, refin=true, refout=true, init=0, xorout=0)
// Verified: CRC("123456789") = 0xA1 ✓
// ============================================================
class Crc8 {
    constructor() {
        // Generate non-reflected CRC-8 table with poly=0x31
        // Matches the hardcoded int[] array in Crc8.java
        this.crcTable = new Uint8Array(256);
        for (let i = 0; i < 256; i++) {
            let crc = i;
            for (let j = 0; j < 8; j++) {
                crc = (crc & 0x80) ? ((crc << 1) ^ 0x31) & 0xFF : (crc << 1) & 0xFF;
            }
            this.crcTable[i] = crc;
        }
    }

    // Reflect all 8 bits of a byte (identical to Java reflect8)
    reflect8(val) {
        let res = 0;
        for (let i = 0; i < 8; i++) {
            if ((val >> i) & 1) res |= 1 << (7 - i);
        }
        return res & 0xFF;
    }

    // Matches Java Crc8.compute exactly:
    //   for each byte: curByte=reflect8(b), data=curByte^crc, crc=table[data]
    //   return reflect8(crc) ^ 0
    compute(bytes) {
        let crc = 0;
        for (const b of bytes) {
            const curByte = this.reflect8(b & 0xFF);
            const data = (curByte ^ crc) & 0xFF;
            crc = this.crcTable[data];
        }
        return this.reflect8(crc) & 0xFF;
    }
}


const crc8 = new Crc8();

// ============================================================
// Command Builder (1:1 parity with com.timeylies.ninehack.CommandCreator)
//
// Java byte arithmetic is signed 8-bit. We must replicate this precisely:
// - originalRand: random int 1..254 cast to signed byte → values 1..127 stay,
//   128..254 become -128..-2 in signed, but we do all XOR in JS at full int level
//   and mask with &0xFF at the end, which is equivalent.
// - rand = (byte)(originalRand + 50) — can overflow, mask with &0xFF
// - key = (byte)(originalKey ^ originalRand) — mask with &0xFF
// ============================================================
function buildCommand(originalCmd, originalData, useAuthKey = false) {
    // Java: (byte)(((byte) new Random().nextInt(254)) + 1)
    // nextInt(254) gives 0..253, cast to byte (all fit), +1 gives 1..254
    const originalRand = Math.floor(Math.random() * 254) + 1;

    // Java: byte rand = (byte)(originalRand + 50)  — overflow wraps at 8 bit
    const rand = (originalRand + 50) & 0xFF;

    let key, cmd, data;

    if (useAuthKey) {
        // GetKeyCommand: key = (byte)(0 ^ originalRand) = originalRand & 0xFF
        key = (0 ^ originalRand) & 0xFF;
        cmd = (originalCmd ^ originalRand) & 0xFF;
        // Data = XOR each byte of the BLE key string with originalRand
        data = [];
        for (let i = 0; i < bleKey.length; i++) {
            data.push((bleKey.charCodeAt(i) ^ originalRand) & 0xFF);
        }
    } else {
        // All other commands
        key = (actualKey ^ originalRand) & 0xFF;
        cmd = (originalCmd ^ originalRand) & 0xFF;
        data = originalData.map(b => (b ^ originalRand) & 0xFF);
    }

    // Java hardcodes the length field as the number of data bytes
    // NOTE: getKeyCommand hardcodes length=8 (bleKey is always 8 chars)
    // getUnlockCommand hardcodes length=10, getLockCommand=1, getSetScooter=4, getEjectBattery=1
    const length = data.length & 0xFF;
    const packet = [...HEADER, length, rand, key, cmd, ...data];
    const crc = crc8.compute(packet) & 0xFF;

    return new Uint8Array([...packet, crc]);
}

// BLE Commands generators (match Java CommandCreator exactly)
function getKeyCommand(keyString) {
    if (keyString) bleKey = keyString;
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

// ============================================================
// Web Bluetooth Scanning & Connection
//
// IMPORTANT: Ninebot/Xiaomi scooters do NOT always advertise the UART service UUID
// in their BLE advertisement packets. They may advertise with custom names, MACs or
// generic services. Therefore we use acceptAllDevices:true so the user can see
// ALL nearby BLE devices in the picker dialog.
// ============================================================
async function scanForDevices() {
    if (!navigator.bluetooth) {
        showToast('Kein Web Bluetooth! Bitte Bluefy App auf iOS nutzen.');
        return;
    }

    // Disconnect existing GATT session if still connected to free up BLE on iOS
    if (bluetoothDevice && bluetoothDevice.gatt && bluetoothDevice.gatt.connected) {
        try {
            bluetoothDevice.gatt.disconnect();
        } catch (e) {
            console.warn('Disconnect before scan error:', e);
        }
    }

    const scanBtn = document.getElementById('scan-btn');
    scanBtn.textContent = 'Suche...';
    scanBtn.classList.add('scanning');
    scanBtn.disabled = true;

    try {
        addLog('Suche nach Bluetooth-Geräten...');

        // Use acceptAllDevices so that scooters with non-standard advertisements appear.
        // Declare UART_SERVICE and standard Xiaomi/Ninebot service UUIDs in optionalServices
        // so Web Bluetooth permits access to them after connecting.
        bluetoothDevice = await navigator.bluetooth.requestDevice({
            acceptAllDevices: true,
            optionalServices: [
                UART_SERVICE,
                '0000fe95-0000-1000-8000-00805f9b34fb', // Xiaomi / Ninebot FE95 service
                '00001800-0000-1000-8000-00805f9b34fb', // Generic Access
                '00001801-0000-1000-8000-00805f9b34fb', // Generic Attribute
                '0000180a-0000-1000-8000-00805f9b34fb'  // Device Information
            ]
        });

        // Use name if present, otherwise display the device ID string (no "Unbekanntes Gerät")
        const deviceLabel = bluetoothDevice.name || bluetoothDevice.id || 'N/A';
        addLog(`Gerät ausgewählt: ${deviceLabel}`);

        bluetoothDevice.addEventListener('gattserverdisconnected', onDisconnected);

        await connectToDevice();

    } catch (error) {
        if (error.name === 'NotFoundError' || error.name === 'AbortError') {
            addLog('Geräteauswahl abgebrochen.', 'info');
        } else {
            addLog(`Fehler: ${error.message}`, 'error');
            showToast('Verbindung fehlgeschlagen');
        }
    } finally {
        scanBtn.textContent = 'Scan';
        scanBtn.classList.remove('scanning');
        scanBtn.disabled = false;
    }
}

async function connectToDevice() {
    try {
        addLog('Verbinde mit GATT-Server...');
        updateConnectionBadge('connecting', 'Verbinde...');

        bluetoothServer = await bluetoothDevice.gatt.connect();
        addLog('Verbunden!');

        addLog('Suche UART-Service...');
        bluetoothService = await bluetoothServer.getPrimaryService(UART_SERVICE);
        addLog('Service gefunden!');

        addLog('Lese Characteristics...');
        txCharacteristic = await bluetoothService.getCharacteristic(UART_TX_CHAR);
        rxCharacteristic = await bluetoothService.getCharacteristic(UART_RX_CHAR);

        addLog('Aktiviere Notifications...');
        await txCharacteristic.startNotifications();
        txCharacteristic.addEventListener('characteristicvaluechanged', handleNotification);
        addLog('Notifications aktiviert!');

        // Switch to control screen
        showScreen('control-screen');
        clearLog();
        const deviceLabel = bluetoothDevice.name || bluetoothDevice.id || 'N/A';
        addLog('Verbunden mit: ' + deviceLabel);
        addLog('Aktiviere Notifications...');
        addLog('Notifications aktiv!');

        // Authenticate
        await sendFirstStageAuth();

    } catch (error) {
        addLog(`Verbindungsfehler: ${error.message}`, 'error');
        updateConnectionBadge('disconnected', 'Getrennt');
        showToast('App konnte nicht verbinden');
        throw error;
    }
}

function onDisconnected() {
    addLog('Getrennt', 'error');
    updateConnectionBadge('disconnected', 'Getrennt');
    isAuthenticated = false;
    isAutoTryingKeys = false;
    disableControls();
}

async function sendFirstStageAuth() {
    addLog('Sende GetKey-Befehl...');
    try {
        const authCommand = getKeyCommand(bleKey);
        // Use writeValueWithoutResponse for WRITE_NO_RESPONSE characteristic type
        // (Java uses setWriteType(2) = WRITE_TYPE_NO_RESPONSE)
        if (rxCharacteristic.properties.writeWithoutResponse) {
            await rxCharacteristic.writeValueWithoutResponse(authCommand);
        } else {
            await rxCharacteristic.writeValue(authCommand);
        }
        addLog('Befehl gesendet!');
    } catch (error) {
        addLog(`Fehler beim Senden: ${error.message}`, 'error');
    }
}

// Helper for writing commands - uses writeValueWithoutResponse when available
// because Java uses setWriteType(2) = BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE
async function writeCommand(command) {
    if (!rxCharacteristic) return;
    if (rxCharacteristic.properties.writeWithoutResponse) {
        await rxCharacteristic.writeValueWithoutResponse(command);
    } else {
        await rxCharacteristic.writeValue(command);
    }
    addLog('Befehl gesendet!');
}

// ============================================================
// Web Bluetooth notification handler
// event.target.value is a DataView — must convert correctly
// ============================================================
function handleNotification(event) {
    const dataView = event.target.value;
    if (!dataView) return;

    // Correct DataView → Uint8Array conversion
    const bytes = new Uint8Array(dataView.buffer, dataView.byteOffset, dataView.byteLength);

    addLog(`Empfangen: ${bytesToHex(bytes)}`, 'info');

    // Check header: Java Header = {-93, -92} = {0xA3, 0xA4}
    if (bytes.length >= 7 && bytes[0] === 0xA3 && bytes[1] === 0xA4) {
        const length = bytes[2];

        // rand decoding: Java does (byte)(Array.getByte(message, 3) - 50)
        // In signed byte arithmetic: bytes[3] is unsigned here, but the value
        // stored was (originalRand + 50) & 0xFF. To recover originalRand:
        // We need: rand = storedRand - 50 as a signed byte
        // The XOR works regardless of sign, so we treat rand as an 8-bit value:
        const storedRand = bytes[3];
        // Compute rand as signed byte: ((storedRand - 50) & 0xFF) gives the same
        // XOR results as the Java signed byte subtraction because XOR doesn't care about sign
        const rand = (storedRand - 50) & 0xFF;

        const cmd = (bytes[5] ^ rand) & 0xFF;

        const data = [];
        for (let i = 0; i < length && (6 + i) < bytes.length; i++) {
            data.push((bytes[6 + i] ^ rand) & 0xFF);
        }

        processResponse(cmd, data);
    }
}

// ============================================================
// Decode scooter response packets (1:1 with CommandCreator.decodeMessage)
// ============================================================
function processResponse(cmd, data) {
    switch (cmd) {
        case COMMAND_BYTES[0]: // 0x01 - Authentication response
            if (data[0] === 1) {
                actualKey = data[1];
                isAuthenticated = true;
                isAutoTryingKeys = false;

                addLog('Key is Correct!', 'success');
                addLog(`Key: 0x${actualKey.toString(16).toUpperCase().padStart(2, '0')}`, 'success');
                updateConnectionBadge('connected', 'Authentifiziert ✓');

                // Save working key
                localStorage.setItem('ble_key', bleKey);
                const keyInput = document.getElementById('ble-key-input');
                if (keyInput) keyInput.value = bleKey;
                enableControls();
                showToast('Authentifizierung erfolgreich!');
            } else {
                addLog('Uh oh, key is incorrect!', 'error');
                addLog('Try another key by changing it in the main screen!', 'error');

                if (isAutoTryingKeys) {
                    currentKeyIndex++;
                    setTimeout(() => tryNextAutoKey(), 500);
                } else {
                    updateConnectionBadge('error', 'Falscher Key');
                    showToast('Key falsch! Anderen Key versuchen.');
                }
            }
            break;

        case COMMAND_BYTES[1]: // 0x10 - Error response
            addLog('Uh oh, we got an error from the scooter!', 'error');
            if (data[0] === 1) {
                addLog('BUG! CRC Bad!', 'error');
            }
            break;

        case COMMAND_BYTES[2]: // 0x05 - Unlock response
            if (data[0] === 1) {
                addLog('Scooter Unlocked Successfully!', 'success');
                showToast('Scooter entsperrt! ✓');
            } else {
                addLog('Scooter Unlock Failed!', 'error');
                showToast('Entsperren fehlgeschlagen!');
            }
            break;

        case COMMAND_BYTES[3]: // 0x15 - Lock response
            if (data[0] === 1) {
                addLog('Scooter Locked Successfully!', 'success');
                showToast('Scooter gesperrt! ✓');
            } else {
                addLog('Scooter Lock Failed!', 'error');
                showToast('Sperren fehlgeschlagen!');
            }
            break;

        case COMMAND_BYTES[4]: // 0x61 - Set scooter response
            if (data[0] === 0) {
                addLog('Scooter Set Successfully!', 'success');
                showToast('Einstellungen übernommen! ✓');
            } else {
                addLog('Scooter Set Failed!', 'error');
                showToast('Einstellungen fehlgeschlagen!');
            }
            break;

        case COMMAND_BYTES[5]: // 0x81 - Eject battery response
            if (data[0] === 1) {
                addLog('Scooter Battery Ejected Successfully!', 'success');
                showToast('Akku ausgeworfen! ✓');
            } else {
                addLog('Scooter Battery Eject Failed!', 'error');
                showToast('Akku-Auswurf fehlgeschlagen!');
            }
            break;

        default:
            addLog(`Unbekannter Befehl: 0x${cmd.toString(16).toUpperCase().padStart(2,'0')}`, 'info');
    }
}

// ============================================================
// Scooter Actions
// ============================================================
async function sendUnlockCommand() {
    if (!isAuthenticated) { showToast('Zuerst authentifizieren!'); return; }
    try {
        addLog('Sende Entsperr-Befehl...');
        await writeCommand(getUnlockCommand());
    } catch (error) {
        addLog(`Fehler: ${error.message}`, 'error');
    }
}

async function sendLockCommand() {
    if (!isAuthenticated) { showToast('Zuerst authentifizieren!'); return; }
    try {
        addLog('Sende Sperr-Befehl...');
        await writeCommand(getLockCommand());
    } catch (error) {
        addLog(`Fehler: ${error.message}`, 'error');
    }
}

async function sendSetScooterCommand() {
    if (!isAuthenticated) { showToast('Zuerst authentifizieren!'); return; }

    const modeEl = document.querySelector('input[name="mode"]:checked');
    const mode = modeEl ? parseInt(modeEl.value) : 3;

    const headlightChecked = document.getElementById('headlight-switch').checked;
    const throttleChecked  = document.getElementById('throttle-switch').checked;

    // Java mapping: headlight=2 means ON, headlight=1 means OFF (same for throttle)
    const headlight = headlightChecked ? 2 : 1;
    const throttle  = throttleChecked  ? 2 : 1;

    try {
        addLog(`Einstellungen: Mode ${mode}, Licht ${headlightChecked ? 'AN' : 'AUS'}, Drossel ${throttleChecked ? 'AN' : 'AUS'}`);
        await writeCommand(getSetScooterCommand(headlight, mode, throttle));
    } catch (error) {
        addLog(`Fehler: ${error.message}`, 'error');
    }
}

async function sendEjectBatteryCommand() {
    if (!isAuthenticated) { showToast('Zuerst authentifizieren!'); return; }
    try {
        addLog('Sende Akku-Auswurf-Befehl...');
        await writeCommand(getEjectBatteryCommand());
    } catch (error) {
        addLog(`Fehler: ${error.message}`, 'error');
    }
}

// Auto Key scanner - tries all known universal keys sequentially
async function startAutoKeyScan() {
    if (!rxCharacteristic) {
        showToast('Nicht verbunden!');
        return;
    }
    addLog('Starte Auto-Key-Scan...');
    isAutoTryingKeys = true;
    isAuthenticated = false;
    disableControls();
    currentKeyIndex = 0;
    await tryNextAutoKey();
}

async function tryNextAutoKey() {
    if (!isAutoTryingKeys) return;

    if (currentKeyIndex >= BLE_KEYS.length) {
        addLog('Alle Standard-Keys fehlgeschlagen.', 'error');
        isAutoTryingKeys = false;
        showToast('Kein passender Key gefunden');
        return;
    }

    const keyToTry = BLE_KEYS[currentKeyIndex];
    bleKey = keyToTry;
    addLog(`Teste Key ${currentKeyIndex + 1}/${BLE_KEYS.length}: ${keyToTry}`);

    try {
        await writeCommand(getKeyCommand(keyToTry));
        // Wait for auth response (handleNotification will call tryNextAutoKey via processResponse)
        // If no response in 2 seconds, move to next key
        setTimeout(() => {
            if (isAutoTryingKeys && !isAuthenticated && currentKeyIndex < BLE_KEYS.length) {
                const currentKey = BLE_KEYS[currentKeyIndex];
                if (bleKey === currentKey) {
                    // No response received, try next
                    currentKeyIndex++;
                    tryNextAutoKey();
                }
            }
        }, 2000);
    } catch (error) {
        addLog(`Fehler mit Key ${keyToTry}: ${error.message}`, 'error');
        currentKeyIndex++;
        setTimeout(() => tryNextAutoKey(), 500);
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
    updateConnectionBadge('disconnected', 'Getrennt');
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