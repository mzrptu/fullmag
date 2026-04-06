export interface PickFileResult {
  name: string;
  text: string;
}

const STAGED_FILE_PREFIX = "fullmag.launch_asset.";

export async function pickTextFile(): Promise<PickFileResult | null> {
  if (typeof window === "undefined") return null;
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".py,.json,.fm,.yaml,.yml,.txt";
  input.style.display = "none";
  document.body.appendChild(input);
  const result = await new Promise<PickFileResult | null>((resolve) => {
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      const text = await file.text();
      resolve({ name: file.name, text });
    };
    input.click();
  });
  document.body.removeChild(input);
  return result;
}

export interface StagedLaunchAsset {
  id: string;
  name: string;
  text: string;
  updatedAtUnixMs: number;
}

export function stageLaunchTextFile(file: PickFileResult): string | null {
  if (typeof window === "undefined") return null;
  const id = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const asset: StagedLaunchAsset = {
    id,
    name: file.name,
    text: file.text,
    updatedAtUnixMs: Date.now(),
  };
  window.sessionStorage.setItem(`${STAGED_FILE_PREFIX}${id}`, JSON.stringify(asset));
  return id;
}

export function readStagedLaunchAsset(id: string | null | undefined): StagedLaunchAsset | null {
  if (typeof window === "undefined" || !id) return null;
  try {
    const raw = window.sessionStorage.getItem(`${STAGED_FILE_PREFIX}${id}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StagedLaunchAsset;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}
