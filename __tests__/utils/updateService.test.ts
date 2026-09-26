import { Linking } from "react-native";
import {
  isVersionNewer,
  LATEST_RELEASE_API,
  LATEST_RELEASE_PAGE_URL,
  parseCleanVersion,
  updateService,
} from "../../src/utils/updateService";

// Mock localStorage
const mockStorage = new Map<string, string>();
const mockLocalStorage = {
  setItem: jest.fn((key: string, value: string) => {
    mockStorage.set(key, value);
  }),
  getItem: jest.fn((key: string) => {
    return mockStorage.get(key) || null;
  }),
  removeItem: jest.fn((key: string) => {
    mockStorage.delete(key);
  }),
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
global.localStorage = mockLocalStorage as any;

describe("updateService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStorage.clear();
  });

  describe("version parsing and comparison", () => {
    it("parses clean semver correctly", () => {
      expect(parseCleanVersion("v1.4.0")).toEqual([1, 4, 0]);
      expect(parseCleanVersion("0.1.0")).toEqual([0, 1, 0]);
      expect(parseCleanVersion("v1.2.3-dev+abc1234")).toEqual([1, 2, 3]);
      expect(parseCleanVersion("v2.0.0-beta.1")).toEqual([2, 0, 0]);
      expect(parseCleanVersion("")).toEqual([0, 0, 0]);
      expect(parseCleanVersion("invalid")).toEqual([0, 0, 0]);
    });

    it("correctly determines if remote version is newer", () => {
      expect(isVersionNewer("v1.4.0", "v1.3.1")).toBe(true);
      expect(isVersionNewer("v0.10.0", "v0.9.9")).toBe(true);
      expect(isVersionNewer("v1.0.0", "v0.9.9")).toBe(true);
      expect(isVersionNewer("v1.4.0", "v1.4.0")).toBe(false);
      expect(isVersionNewer("v1.3.1", "v1.4.0")).toBe(false);
      expect(isVersionNewer("v1.4.0", "v0.1.0-dev+abc1234")).toBe(true);
    });
  });

  describe("snooze settings in localStorage", () => {
    it("reads and writes snooze settings", () => {
      const initial = updateService.getUpdateSnooze();
      expect(initial.version).toBe("");
      expect(initial.until).toBe(0);

      const targetUntil = Date.now() + 7 * 86400000;
      updateService.setUpdateSnooze("v1.4.0", targetUntil);

      const saved = updateService.getUpdateSnooze();
      expect(saved.version).toBe("v1.4.0");
      expect(saved.until).toBe(targetUntil);

      updateService.clearUpdateSnooze();
      const cleared = updateService.getUpdateSnooze();
      expect(cleared.version).toBe("");
      expect(cleared.until).toBe(0);
    });

    it("handles storage exceptions gracefully", () => {
      mockLocalStorage.getItem.mockImplementationOnce(() => {
        throw new Error("Storage unavailable");
      });
      const result = updateService.getUpdateSnooze();
      expect(result).toEqual({ version: "", until: 0 });

      mockLocalStorage.setItem.mockImplementationOnce(() => {
        throw new Error("Storage quota exceeded");
      });
      expect(() => updateService.setUpdateSnooze("v1.4.0", 123)).not.toThrow();

      mockLocalStorage.removeItem.mockImplementationOnce(() => {
        throw new Error("Storage error");
      });
      expect(() => updateService.clearUpdateSnooze()).not.toThrow();
    });
  });

  describe("checkForAvailableUpdate", () => {
    const mockApkRelease = {
      tag_name: "v1.4.0",
      name: "Tractor v1.4.0",
      assets: [
        {
          name: "tractor-v1.4.0.apk",
          browser_download_url:
            "https://github.com/ejfn/Tractor/releases/download/v1.4.0/tractor-v1.4.0.apk",
        },
      ],
    };

    it("returns update info when newer APK release is found", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => mockApkRelease,
      } as unknown as Response);

      const update = await updateService.checkForAvailableUpdate("v1.3.0");

      expect(fetch).toHaveBeenCalledWith(
        LATEST_RELEASE_API,
        expect.objectContaining({
          headers: { Accept: "application/vnd.github.v3+json" },
        }),
      );
      expect(update).toEqual({
        tagName: "v1.4.0",
        version: "1.4.0",
        name: "Tractor v1.4.0",
        releaseUrl: LATEST_RELEASE_PAGE_URL,
        apkDownloadUrl:
          "https://github.com/ejfn/Tractor/releases/download/v1.4.0/tractor-v1.4.0.apk",
      });
    });

    it("returns null if release has no APK asset", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          tag_name: "v1.4.0",
          name: "v1.4.0",
          assets: [{ name: "source-code.tar.gz" }],
        }),
      } as unknown as Response);

      const update = await updateService.checkForAvailableUpdate("v1.3.0");
      expect(update).toBeNull();
    });

    it("returns null if remote version is not newer than current", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => mockApkRelease,
      } as unknown as Response);

      const update = await updateService.checkForAvailableUpdate("v1.4.0");
      expect(update).toBeNull();
    });

    it("returns null if the release is snoozed within 7 days", async () => {
      updateService.snoozeUpdate("v1.4.0", 7);

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => mockApkRelease,
      } as unknown as Response);

      const update = await updateService.checkForAvailableUpdate("v1.3.0");
      expect(update).toBeNull();
    });

    it("returns update if a newer release tag arrives after a previous version was snoozed", async () => {
      updateService.snoozeUpdate("v1.3.0", 7);

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => mockApkRelease, // tag_name: "v1.4.0"
      } as unknown as Response);

      const update = await updateService.checkForAvailableUpdate("v1.2.0");
      expect(update).not.toBeNull();
      expect(update?.tagName).toBe("v1.4.0");
    });

    it("silently catches network errors and returns null", async () => {
      global.fetch = jest
        .fn()
        .mockRejectedValue(new Error("Network connection lost"));

      const update = await updateService.checkForAvailableUpdate("v1.3.0");
      expect(update).toBeNull();
    });

    it("silently catches non-200 responses and returns null", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 403,
      } as unknown as Response);

      const update = await updateService.checkForAvailableUpdate("v1.3.0");
      expect(update).toBeNull();
    });

    it("silently catches invalid JSON payload and returns null", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => null,
      } as unknown as Response);

      const update = await updateService.checkForAvailableUpdate("v1.3.0");
      expect(update).toBeNull();
    });
  });

  describe("openLatestReleasePage", () => {
    it("calls Linking.openURL with the latest release page url", async () => {
      const openURLSpy = jest.spyOn(Linking, "openURL").mockResolvedValue(true);

      await updateService.openLatestReleasePage();
      expect(openURLSpy).toHaveBeenCalledWith(LATEST_RELEASE_PAGE_URL);
    });

    it("silently catches openURL errors", async () => {
      jest
        .spyOn(Linking, "openURL")
        .mockRejectedValueOnce(new Error("Cannot open URL"));
      await expect(
        updateService.openLatestReleasePage(),
      ).resolves.toBeUndefined();
    });
  });
});
