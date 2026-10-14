const firebaseConfig = {
	apiKey: "AIzaSyCiM4S6IyARMb-c3iVEhi027RFv7JoGHYM",
	authDomain: "p2crud-243026022.firebaseapp.com",
	projectId: "p2crud-243026022",
	storageBucket: "p2crud-243026022.firebasestorage.app",
	messagingSenderId: "458385005526",
	appId: "1:458385005526:web:2ede4aee02d33306d6e277"
};

export class MockFirestore {
	constructor() {
		const savedData = JSON.parse(localStorage.getItem("mock_inventory_db") || "[]");
		this.data = savedData.map(({ timestamp, ...document }) => ({
			...document,
			timestamp: { toDate: () => new Date(timestamp) }
		}));
		this.listeners = new Set();
	}

	collection() {
		return this;
	}

	async add(payload) {
		const createdAt = new Date();
		const document = {
			...payload,
			id: Date.now().toString(),
			timestamp: { toDate: () => createdAt }
		};

		this.data.unshift(document);
		if (this.data.length > 50) this.data.pop();

		const savedData = this.data.map(({ timestamp, ...item }) => ({
			...item,
			timestamp: timestamp.toDate().toISOString()
		}));
		localStorage.setItem("mock_inventory_db", JSON.stringify(savedData));
		this.listeners.forEach((listener) => listener(this.data.slice(0, 20)));

		return { id: document.id };
	}

	orderBy() {
		return this;
	}

	limit() {
		return this;
	}

	onSnapshot(callback) {
		this.listeners.add(callback);
		callback(this.data.slice(0, 20));
		return () => this.listeners.delete(callback);
	}
}

export const isMockMode = new URLSearchParams(window.location.search).get("db") === "mock";
export let app = null;
export let db;
let firestoreApi = null;

if (isMockMode) {
	db = new MockFirestore();
} else {
	const [firebaseAppSdk, firestoreSdk] = await Promise.all([
		import("https://www.gstatic.com/firebasejs/9.22.0/firebase-app.js"),
		import("https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js")
	]);

	firestoreApi = firestoreSdk;
	app = firebaseAppSdk.initializeApp(firebaseConfig);
	db = firestoreSdk.getFirestore(app);
}

export function createDetectionTimestamp() {
	return isMockMode ? new Date().toISOString() : firestoreApi.serverTimestamp();
}

export async function saveDetection(payload) {
	if (isMockMode) return db.collection("detections").add(payload);

	const reference = await firestoreApi.addDoc(
		firestoreApi.collection(db, "detections"),
		payload
	);
	return { id: reference.id };
}

export function listenForDetections(onData, onError) {
	if (isMockMode) {
		return db.collection("detections")
			.orderBy("timestamp", "desc")
			.limit(20)
			.onSnapshot(onData);
	}

	const detectionsQuery = firestoreApi.query(
		firestoreApi.collection(db, "detections"),
		firestoreApi.orderBy("timestamp", "desc"),
		firestoreApi.limit(20)
	);

	return firestoreApi.onSnapshot(
		detectionsQuery,
		(snapshot) => onData(snapshot.docs.map((document) => ({
			...document.data(),
			id: document.id
		}))),
		onError
	);
}
