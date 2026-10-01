/* eslint-disable no-undef */
// Global test setup for AsyncStorage mock
// Set DEBUG log level for all tests
import { gameLogger, LogLevel } from "../src/utils/gameLogger";

global.localStorage = {
  setItem: jest.fn(),
  getItem: jest.fn().mockReturnValue(null),
  removeItem: jest.fn(),
};

// Prevent the actual polyfill from running in Jest to avoid Native Database crash
jest.mock("expo-sqlite/localStorage/install", () => {});

// Mock expo-localization for tests
jest.mock("expo-localization", () => ({
  getLocales: jest.fn(() => [{ languageCode: "en" }]),
}));

// Mock react-native-device-info for tests
jest.mock("react-native-device-info", () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("react-native-device-info/jest/react-native-device-info-mock"),
);

gameLogger.setLogLevel(LogLevel.DEBUG);
