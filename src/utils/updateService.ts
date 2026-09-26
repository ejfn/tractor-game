import "expo-sqlite/localStorage/install";
import { Linking } from "react-native";
import { gameLogger } from "./gameLogger";

export interface AppUpdateInfo {
  tagName: string;
  version: string;
  name: string;
  releaseUrl: string;
  apkDownloadUrl?: string;
}

export interface UpdateSnoozeInfo {
  version: string;
  until: number;
}

export const LATEST_RELEASE_API =
  "https://api.github.com/repos/ejfn/Tractor/releases/latest";
export const LATEST_RELEASE_PAGE_URL =
  "https://github.com/ejfn/Tractor/releases/latest";

const STORAGE_KEYS = {
  SNOOZE_VERSION: "tractor_update_snooze_version",
  SNOOZE_UNTIL: "tractor_update_snooze_until",
} as const;

/**
 * Parses semantic version string into [major, minor, patch] numbers.
 * Safely strips 'v', git hashes (+abc1234), and prerelease tags (-dev, -beta).
 */
export const parseCleanVersion = (v: string): [number, number, number] => {
  const withoutV = v.trim().replace(/^v/i, "");
  const base = withoutV.split(/[-+\s]/)[0];
  const parts = base.split(".").map((n) => parseInt(n, 10));
  return [
    isNaN(parts[0]) ? 0 : parts[0],
    isNaN(parts[1]) ? 0 : parts[1],
    isNaN(parts[2]) ? 0 : parts[2],
  ];
};

/**
 * Returns true if remoteTag is strictly newer than currentVersion.
 */
export const isVersionNewer = (
  remoteTag: string,
  currentVersion: string,
): boolean => {
  const [rMajor, rMinor, rPatch] = parseCleanVersion(remoteTag);
  const [cMajor, cMinor, cPatch] = parseCleanVersion(currentVersion);

  if (rMajor !== cMajor) return rMajor > cMajor;
  if (rMinor !== cMinor) return rMinor > cMinor;
  return rPatch > cPatch;
};

export const updateService = {
  /**
   * Retrieves snooze information from localStorage.
   */
  getUpdateSnooze(): UpdateSnoozeInfo {
    try {
      if (typeof localStorage !== "undefined" && localStorage !== null) {
        const version = localStorage.getItem(STORAGE_KEYS.SNOOZE_VERSION) || "";
        const untilStr = localStorage.getItem(STORAGE_KEYS.SNOOZE_UNTIL) || "0";
        return {
          version,
          until: parseInt(untilStr, 10) || 0,
        };
      }
    } catch (error) {
      gameLogger.warn("update_snooze_get_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return { version: "", until: 0 };
  },

  /**
   * Sets snooze information in localStorage.
   */
  setUpdateSnooze(version: string, until: number): void {
    try {
      if (typeof localStorage !== "undefined" && localStorage !== null) {
        localStorage.setItem(STORAGE_KEYS.SNOOZE_VERSION, version);
        localStorage.setItem(STORAGE_KEYS.SNOOZE_UNTIL, String(until));
      }
    } catch (error) {
      gameLogger.warn("update_snooze_set_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },

  /**
   * Clears snooze information from localStorage.
   */
  clearUpdateSnooze(): void {
    try {
      if (typeof localStorage !== "undefined" && localStorage !== null) {
        localStorage.removeItem(STORAGE_KEYS.SNOOZE_VERSION);
        localStorage.removeItem(STORAGE_KEYS.SNOOZE_UNTIL);
      }
    } catch (error) {
      gameLogger.warn("update_snooze_clear_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },

  /**
   * Checks GitHub for a new APK release newer than currentVersion.
   * Catches and eats all errors silently, never exposing failures to the user.
   */
  async checkForAvailableUpdate(
    currentVersion: string,
  ): Promise<AppUpdateInfo | null> {
    try {
      const snooze = this.getUpdateSnooze();

      const response = await fetch(LATEST_RELEASE_API, {
        headers: {
          Accept: "application/vnd.github.v3+json",
        },
      });

      if (!response.ok) {
        return null;
      }

      const data = await response.json();
      if (!data || !data.tag_name || typeof data.tag_name !== "string") {
        return null;
      }

      // If snoozed for this specific version and snooze window is still active, do not notify
      if (snooze.version === data.tag_name && snooze.until > Date.now()) {
        return null;
      }

      // Verify that the release contains an Android APK asset
      const assets = Array.isArray(data.assets) ? data.assets : [];
      const apkAsset = assets.find(
        (asset: { name?: unknown; browser_download_url?: unknown }) =>
          typeof asset.name === "string" &&
          asset.name.toLowerCase().endsWith(".apk"),
      );

      if (!apkAsset) {
        return null;
      }

      // Verify remote version is newer than installed version
      if (!isVersionNewer(data.tag_name, currentVersion)) {
        return null;
      }

      return {
        tagName: data.tag_name,
        version: data.tag_name.replace(/^v/i, ""),
        name: data.name || data.tag_name,
        releaseUrl: LATEST_RELEASE_PAGE_URL,
        apkDownloadUrl:
          typeof apkAsset.browser_download_url === "string"
            ? apkAsset.browser_download_url
            : undefined,
      };
    } catch {
      // Eat all errors completely
      return null;
    }
  },

  /**
   * Snoozes update notifications for the given version for N days (default 7).
   */
  snoozeUpdate(version: string, days: number = 7): void {
    const until = Date.now() + days * 24 * 60 * 60 * 1000;
    this.setUpdateSnooze(version, until);
  },

  /**
   * Opens the GitHub latest release page in the system browser.
   */
  async openLatestReleasePage(): Promise<void> {
    try {
      await Linking.openURL(LATEST_RELEASE_PAGE_URL);
    } catch {
      // Eat error
    }
  },
};
