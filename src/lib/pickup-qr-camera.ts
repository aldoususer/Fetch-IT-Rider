// Decode on the device. Camera frames and QR contents are never uploaded.
export function startPickupCamera(video: HTMLVideoElement, callbacks: {
  onReady: () => void;
  onRead: (text: string) => boolean;
  onError: (message: string) => void;
}) {
  let stopped = false;
  let stream: MediaStream | undefined;
  let frame = 0;
  let lastScan = -Infinity;

  function stop() {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(frame);
    stream?.getTracks().forEach(track => track.stop());
    video.srcObject = null;
    document.removeEventListener("visibilitychange", onVisibilityChange);
  }
  function fail(message: string) {
    if (stopped) return;
    stop();
    callbacks.onError(message);
  }
  function onVisibilityChange() {
    if (document.hidden) fail("Scanning paused when you left the app. Tap Scan pickup QR to try again.");
  }

  document.addEventListener("visibilitychange", onVisibilityChange);
  void (async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        fail("Camera scanning is unavailable here. Open Fetch-It over HTTPS, or enter the six-digit code.");
        return;
      }
      const { default: decode } = await import("jsqr");
      if (stopped) return;
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      if (stopped) { stream.getTracks().forEach(track => track.stop()); return; }
      video.srcObject = stream;
      await video.play();
      if (stopped) return;
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) { fail("Could not start scanning. Enter the passenger’s six-digit code instead."); return; }
      callbacks.onReady();
      function scan(time: number) {
        if (stopped) return;
        try {
          if (time - lastScan >= 250 && video.readyState >= 2 && video.videoWidth && video.videoHeight) {
            lastScan = time;
            const scale = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight));
            canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
            canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
            context!.drawImage(video, 0, 0, canvas.width, canvas.height);
            const image = context!.getImageData(0, 0, canvas.width, canvas.height);
            const result = decode(image.data, image.width, image.height, { inversionAttempts: "dontInvert" });
            if (result && callbacks.onRead(result.data)) { stop(); return; }
          }
          frame = requestAnimationFrame(scan);
        } catch {
          fail("Scanning stopped. Try again, or enter the passenger’s six-digit code.");
        }
      }
      frame = requestAnimationFrame(scan);
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      fail(name === "NotAllowedError" || name === "SecurityError"
        ? "Camera access is off. Allow camera access in your browser settings, or enter the six-digit code."
        : name === "NotFoundError"
          ? "No camera was found. Enter the passenger’s six-digit code instead."
          : "Could not open the camera. Close any other camera apps and retry, or enter the six-digit code.");
    }
  })();
  return stop;
}
