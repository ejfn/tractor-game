import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View, TouchableOpacity } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";

// Import game screen controller directly
import GameScreenController from "../src/screens/GameScreenController";
import { VersionDisplay } from "../src/components/VersionDisplay";
import { UpdateModal } from "../src/components/UpdateModal";
import { AppUpdateInfo, updateService } from "../src/utils/updateService";
import { getAppVersion } from "../src/utils/versioning";
import { gameLogger } from "../src/utils/gameLogger";

export default function Index() {
  const [hasError, setHasError] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<AppUpdateInfo | null>(null);
  const [isUpdateModalVisible, setIsUpdateModalVisible] =
    useState<boolean>(false);

  useEffect(() => {
    updateService
      .checkForAvailableUpdate(getAppVersion())
      .then((update) => {
        if (update) {
          setUpdateInfo(update);
          setIsUpdateModalVisible(true);
        }
      })
      .catch(() => {
        // Eat all errors silently
      });
  }, []);

  const handleDismissUpdate = (hideFor7Days: boolean) => {
    if (hideFor7Days && updateInfo) {
      updateService.snoozeUpdate(updateInfo.tagName, 7);
    }
    setIsUpdateModalVisible(false);
  };

  const handleOpenUpdate = async () => {
    await updateService.openLatestReleasePage();
    setIsUpdateModalVisible(false);
  };

  // Function to render the game screen with error handling
  const renderGameScreen = () => {
    let content;
    try {
      content = <GameScreenController />;
    } catch (error) {
      // Log the error and set error state
      gameLogger.error(
        "game_loading_error",
        { error: error instanceof Error ? error.message : String(error) },
        "Game loading error: " +
          (error instanceof Error ? error.message : String(error)),
      );
      // We need to use setTimeout to avoid state updates during render
      setTimeout(() => setHasError(true), 0);
      // Set error UI content
      content = (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>Error loading game</Text>
          <Text>{error instanceof Error ? error.message : String(error)}</Text>
        </View>
      );
    }
    return content;
  };

  // Debug UI removed since we fixed the issue

  return (
    <SafeAreaView
      style={styles.container}
      edges={["left", "right"]} // Only respect left and right edges, not top or bottom
    >
      <StatusBar style="auto" />
      {hasError ? (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>Something went wrong</Text>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={() => setHasError(false)}
          >
            <Text style={styles.retryText}>Try Again</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.gameContainer}>
          {renderGameScreen()}
          <VersionDisplay />
          <UpdateModal
            visible={isUpdateModalVisible}
            updateInfo={updateInfo}
            onDismiss={handleDismissUpdate}
            onUpdate={handleOpenUpdate}
          />
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F8F9FA",
  },
  gameContainer: {
    flex: 1,
    position: "relative",
  },
  errorContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#FFEBEE",
    padding: 20,
  },
  errorText: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#D32F2F",
    marginBottom: 20,
  },
  retryButton: {
    backgroundColor: "#3F51B5",
    paddingVertical: 12,
    paddingHorizontal: 30,
    borderRadius: 8,
  },
  retryText: {
    color: "white",
    fontWeight: "bold",
    fontSize: 16,
  },
  // Debug styles removed
});
