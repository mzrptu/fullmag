import type * as THREE from "three";
import ViewCube from "../ViewCube";
import HslSphere from "../HslSphere";

interface ViewportGizmoStackProps {
  sceneRef: React.MutableRefObject<any>;
  onRotate?: (quat: THREE.Quaternion) => void;
  onReset?: () => void;
  showOrientationSphere?: boolean;
  orientationSphereAxisConvention?: "identity" | "swapYZ";
  orientationSpherePositionClassName?: string;
}

export default function ViewportGizmoStack({
  sceneRef,
  onRotate,
  onReset,
  showOrientationSphere = false,
  orientationSphereAxisConvention = "identity",
  orientationSpherePositionClassName,
}: ViewportGizmoStackProps) {
  return (
    <>
      <ViewCube sceneRef={sceneRef} onRotate={onRotate} onReset={onReset} />
      {showOrientationSphere ? (
        <HslSphere
          sceneRef={sceneRef}
          axisConvention={orientationSphereAxisConvention}
          positionClassName={orientationSpherePositionClassName}
        />
      ) : null}
    </>
  );
}
