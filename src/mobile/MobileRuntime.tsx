import { useEffect, type PropsWithChildren } from "react";
import { MobileDeviceProvider, useMobileDevice } from "./Device";
import { KeyboardDock, KeyboardProvider, useKeyboard } from "./Keyboard";
import { PhoneFrame } from "./PhoneFrame";
import { HomeIndicator, StatusBar } from "./components";

export function MobileRuntime({ children }: PropsWithChildren) {
  const preview = typeof window !== "undefined"
    && new URLSearchParams(window.location.search).get("preview") === "1";

  return (
    <MobileDeviceProvider>
      {preview ? (
        <PhoneFrame>
          <KeyboardProvider>
            <KeyboardPreview />
            <StatusBar />
            <MobileAppViewport>{children}</MobileAppViewport>
            <HomeIndicator />
            <KeyboardDock />
          </KeyboardProvider>
        </PhoneFrame>
      ) : (
        <KeyboardProvider>
          <div className="mobile-live-runtime">
            <MobileAppViewport>{children}</MobileAppViewport>
          </div>
        </KeyboardProvider>
      )}
    </MobileDeviceProvider>
  );
}

function MobileAppViewport({ children }: PropsWithChildren) {
  const { device } = useMobileDevice();
  const keyboard = useKeyboard();

  return (
    <div
      className="mobile-app-viewport"
      data-keyboard-visible={keyboard.visible ? "true" : "false"}
      data-platform={device.platform}
      data-testid="mobile-app-viewport"
    >
      {children}
    </div>
  );
}

function KeyboardPreview() {
  const keyboard = useKeyboard();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("keyboard") === "1") {
      keyboard.show();
    }
  }, [keyboard]);

  return null;
}
