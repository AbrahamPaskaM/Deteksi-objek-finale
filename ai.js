import { startCamera } from "./camera.js";
import { createDetectionTimestamp, saveDetection } from "./db.js";

const TARGET_CLASSES = new Set([
	"person", "bicycle", "car", "motorcycle", "bus", "truck",
	"backpack", "handbag", "suitcase", "bottle", "cup", "bowl",
	"chair", "couch", "potted plant", "bed", "dining table",
	"tv", "laptop", "mouse", "remote", "keyboard", "cell phone",
	"book", "clock", "scissors", "vase", "toothbrush"
]);

const SAVE_THROTTLE_MS = 3000;
const MIN_CONFIDENCE = 0.4;

const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const context = canvas.getContext("2d");
const cameraContainer = document.getElementById("camera-container");
const overlay = document.getElementById("overlay-msg");
const overlayText = document.getElementById("overlay-text");
const startButton = document.getElementById("start-ai");
const stopButton = document.getElementById("stop-ai");
const appStatus = document.getElementById("app-status");
const detectionTitle = document.getElementById("detection-title");
const detectionDetail = document.getElementById("detection-detail");
const detectionChips = document.getElementById("detection-chips");

let model = null;
let modelLoadPromise = null;
let isAIDetecting = false;
let isLoadingModel = false;
let animationFrame = null;
let lastSaveTime = 0;
let isSaving = false;

function showToast(message) {
	appStatus.textContent = message;
}

function showOverlay(message) {
	overlayText.textContent = message;
	overlay.hidden = false;
}

function hideOverlay() {
	overlay.hidden = true;
}

function syncCanvasSize() {
	if (!video.videoWidth || !video.videoHeight) return;
	if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
		canvas.width = video.videoWidth;
		canvas.height = video.videoHeight;
		cameraContainer.style.aspectRatio = `${video.videoWidth} / ${video.videoHeight}`;
	}
}

function updateDetectionSummary(predictions) {
	if (predictions.length === 0) {
		detectionTitle.textContent = isAIDetecting ? "Mencari objek..." : "Siap mendeteksi";
		detectionDetail.textContent = isAIDetecting
			? "Arahkan kamera ke objek"
			: "Aktifkan AI Scan untuk mulai";
		detectionChips.replaceChildren();
		return;
	}

	const bestPrediction = predictions.reduce((best, prediction) =>
		prediction.score > best.score ? prediction : best
	);
	detectionTitle.textContent = bestPrediction.class;
	detectionDetail.textContent = `${predictions.length} objek terdeteksi · Confidence ${Math.round(bestPrediction.score * 100)}%`;
	detectionChips.replaceChildren();
	predictions.slice(0, 3).forEach((prediction) => {
		const chip = document.createElement("span");
		chip.className = "detection-chip";
		chip.textContent = `${prediction.class} · ${Math.round(prediction.score * 100)}%`;
		detectionChips.appendChild(chip);
	});
}

async function loadCocoModel() {
	if (model) return model;
	if (modelLoadPromise) return modelLoadPromise;
	if (!globalThis.cocoSsd) {
		throw new Error("Library COCO-SSD gagal dimuat. Periksa koneksi internet.");
	}

	showOverlay("Memuat model AI COCO-SSD...");
	modelLoadPromise = globalThis.cocoSsd.load({ base: "mobilenet_v2" });
	try {
		model = await modelLoadPromise;
		hideOverlay();
		console.log("Model AI berhasil dimuat:", model);
		return model;
	} catch (error) {
		modelLoadPromise = null;
		showOverlay("Gagal memuat model AI. Periksa koneksi internet.");
		throw error;
	}
}

function drawPredictions(predictions) {
	context.clearRect(0, 0, canvas.width, canvas.height);
	context.lineWidth = 3;
	context.font = "bold 14px sans-serif";

	for (const prediction of predictions) {
		const [x, y, width, height] = prediction.bbox;
		const color = "#10b981";

		context.strokeStyle = color;
		context.strokeRect(x, y, width, height);

		const label = `${prediction.class} ${(prediction.score * 100).toFixed(0)}%`;
		const labelY = Math.max(0, y - 25);
		context.fillStyle = color;
		context.fillRect(x, labelY, context.measureText(label).width + 10, 25);
		context.fillStyle = "#ffffff";
		context.fillText(label, x + 5, labelY + 17);
	}
}

async function saveToDatabase(predictions) {
	const items = predictions
		.map((prediction) => `${prediction.class} (${(prediction.score * 100).toFixed(0)}%)`)
		.join(", ");
	const payload = {
		items,
		count: predictions.length,
		deviceId: "BROWSER-TEST",
		timestamp: createDetectionTimestamp()
	};

	try {
		const result = await saveDetection(payload);
		showToast(`${predictions.length} objek tersimpan.`);
		console.log("Data deteksi tersimpan:", result.id);
	} catch (error) {
		console.error("Gagal menyimpan data deteksi:", error);
		showToast("Gagal menyimpan hasil deteksi.");
	}
}

async function detectLoop() {
	if (!isAIDetecting) return;

	try {
		syncCanvasSize();
		const predictions = await model.detect(video, 30, MIN_CONFIDENCE);
		if (!isAIDetecting) return;
		const targets = predictions.filter((prediction) =>
			TARGET_CLASSES.has(prediction.class) && prediction.score >= MIN_CONFIDENCE
		);
		drawPredictions(targets);
		updateDetectionSummary(targets);

		const now = Date.now();
		if (targets.length > 0 && !isSaving && now - lastSaveTime >= SAVE_THROTTLE_MS) {
			lastSaveTime = now;
			isSaving = true;
			void saveToDatabase(targets).finally(() => {
				isSaving = false;
			});
		}

		animationFrame = requestAnimationFrame(detectLoop);
	} catch (error) {
		console.error("Deteksi objek gagal:", error);
		stopAI();
		showOverlay("Deteksi gagal. Periksa console browser.");
	}
}

export async function loadModel() {
	return loadCocoModel();
}

export async function startAI() {
	if (isAIDetecting || isLoadingModel) return;

	isLoadingModel = true;
	startButton.disabled = true;
	stopButton.disabled = true;
	cameraContainer.hidden = false;
	showOverlay("Mengaktifkan kamera...");

	try {
		const stream = await startCamera();
		if (!stream) throw new Error("Kamera belum berhasil diaktifkan.");

		await loadCocoModel();
		if (!stream.active) throw new Error("Stream kamera sudah dihentikan.");

		syncCanvasSize();
		isAIDetecting = true;
		updateDetectionSummary([]);
		hideOverlay();
		animationFrame = requestAnimationFrame(detectLoop);
	} catch (error) {
		console.error("Gagal memulai AI:", error);
		showOverlay(error.message || "Gagal memulai deteksi objek.");
	} finally {
		isLoadingModel = false;
		startButton.disabled = isAIDetecting;
		stopButton.disabled = !isAIDetecting;
		startButton.hidden = isAIDetecting;
		stopButton.hidden = !isAIDetecting;
	}
}

export function stopAI() {
	isAIDetecting = false;
	if (animationFrame !== null) cancelAnimationFrame(animationFrame);
	animationFrame = null;
	context.clearRect(0, 0, canvas.width, canvas.height);
	startButton.disabled = false;
	stopButton.disabled = true;
	startButton.hidden = false;
	stopButton.hidden = true;
	updateDetectionSummary([]);
	hideOverlay();
}