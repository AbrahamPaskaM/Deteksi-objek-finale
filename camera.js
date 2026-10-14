let activeStream = null;
let isStarting = false;
let facingMode = "environment";
let torchEnabled = false;

const getVideo = () => document.getElementById("video");

function updateCameraControls() {
	const hasCamera = Boolean(activeStream?.active);
	const startButton = document.getElementById("start-camera");
	const stopButton = document.getElementById("stop-camera");
	const switchButton = document.getElementById("switch-camera");
	const torchButton = document.getElementById("toggle-torch");
	const videoTrack = activeStream?.getVideoTracks()[0];
	const supportsTorch = Boolean(videoTrack?.getCapabilities?.().torch);

	if (startButton) startButton.disabled = hasCamera || isStarting;
	if (startButton) startButton.hidden = hasCamera;
	if (stopButton) {
		stopButton.disabled = !hasCamera;
		stopButton.hidden = !hasCamera;
	}
	if (switchButton) {
		switchButton.disabled = !hasCamera || isStarting;
		switchButton.setAttribute(
			"aria-label",
			facingMode === "environment" ? "Beralih ke kamera depan" : "Beralih ke kamera belakang"
		);
	}
	if (torchButton) {
		torchButton.disabled = !hasCamera || !supportsTorch || isStarting;
		torchButton.setAttribute("aria-pressed", String(torchEnabled));
		torchButton.setAttribute("aria-label", `${torchEnabled ? "Matikan" : "Aktifkan"} flash`);
	}
}

async function openCamera(requestedFacingMode, exactFacingMode) {
	const video = getVideo();
	if (!video) throw new Error("Elemen video tidak ditemukan.");
	if (!navigator.mediaDevices?.getUserMedia) {
		throw new Error("Akses kamera memerlukan localhost atau koneksi HTTPS.");
	}

	const stream = await navigator.mediaDevices.getUserMedia({
		video: {
			facingMode: exactFacingMode
				? { exact: requestedFacingMode }
				: { ideal: requestedFacingMode },
			width: { ideal: 1280 },
			height: { ideal: 720 }
		},
		audio: false
	});

	try {
		video.srcObject = stream;
		await new Promise((resolve, reject) => {
			if (video.readyState >= 1) {
				resolve();
				return;
			}
			const onLoadedMetadata = () => {
				video.removeEventListener("error", onError);
				resolve();
			};
			const onError = () => {
				video.removeEventListener("loadedmetadata", onLoadedMetadata);
				reject(new Error("Video kamera tidak dapat dibuka."));
			};
			video.addEventListener("loadedmetadata", onLoadedMetadata, { once: true });
			video.addEventListener("error", onError, { once: true });
		});
		await video.play();
	} catch (error) {
		stream.getTracks().forEach((track) => track.stop());
		video.srcObject = null;
		throw error;
	}

	activeStream = stream;
	facingMode = stream.getVideoTracks()[0]?.getSettings?.().facingMode || requestedFacingMode;
	torchEnabled = false;
	console.log("Kamera berhasil dinyalakan:", video.videoWidth, "x", video.videoHeight);
	updateCameraControls();
	return stream;
}

export async function startCamera({ facingMode: requestedFacingMode = facingMode, exact = false } = {}) {
	if (activeStream?.active) return activeStream;
	if (isStarting) throw new Error("Kamera sedang diaktifkan.");

	isStarting = true;
	updateCameraControls();
	try {
		return await openCamera(requestedFacingMode, exact);
	} finally {
		isStarting = false;
		updateCameraControls();
	}
}

export async function switchCamera() {
	if (!activeStream?.active) return startCamera();
	if (isStarting) throw new Error("Kamera sedang diproses.");

	const previousFacingMode = facingMode;
	const nextFacingMode = previousFacingMode === "environment" ? "user" : "environment";
	stopCamera();

	try {
		return await startCamera({ facingMode: nextFacingMode, exact: true });
	} catch (switchError) {
		try {
			await startCamera({ facingMode: previousFacingMode, exact: true });
		} catch (restoreError) {
			throw new AggregateError(
				[switchError, restoreError],
				"Kamera tidak dapat diganti dan kamera sebelumnya gagal dipulihkan."
			);
		}
		throw switchError;
	}
}

export async function toggleTorch() {
	const videoTrack = activeStream?.getVideoTracks()[0];
	if (!videoTrack) throw new Error("Kamera belum aktif.");
	if (!videoTrack.getCapabilities?.().torch) {
		throw new Error("Flash tidak didukung oleh kamera atau browser ini.");
	}

	const nextTorchState = !torchEnabled;
	await videoTrack.applyConstraints({ advanced: [{ torch: nextTorchState }] });
	torchEnabled = nextTorchState;
	updateCameraControls();
	return torchEnabled;
}

export function stopCamera() {
	const video = getVideo();
	const stream = activeStream || video?.srcObject;

	if (stream) stream.getTracks().forEach((track) => track.stop());
	if (video) video.srcObject = null;
	activeStream = null;
	torchEnabled = false;
	updateCameraControls();
}
