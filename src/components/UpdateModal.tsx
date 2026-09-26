import React, { useState } from "react";
import {
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from "react-native";
import { useModalsTranslation } from "../hooks/useTranslation";
import { AppUpdateInfo } from "../utils/updateService";

export interface UpdateModalProps {
  visible: boolean;
  updateInfo: AppUpdateInfo | null;
  onDismiss: (hideFor7Days: boolean) => void;
  onUpdate: () => void;
}

export const UpdateModal: React.FC<UpdateModalProps> = ({
  visible,
  updateInfo,
  onDismiss,
  onUpdate,
}) => {
  const { t } = useModalsTranslation();
  const [dontRemind, setDontRemind] = useState<boolean>(false);

  if (!visible || !updateInfo) {
    return null;
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={() => onDismiss(dontRemind)}
    >
      <TouchableWithoutFeedback onPress={() => onDismiss(dontRemind)}>
        <View style={styles.backdrop}>
          <TouchableWithoutFeedback>
            <View style={styles.dialogCard}>
              {/* Top Accent Icon Circle */}
              <View style={styles.iconContainer}>
                <Text style={styles.iconText}>🚀</Text>
              </View>

              {/* Title & Description */}
              <Text style={styles.title}>{t("update.title")}</Text>
              <Text style={styles.message}>
                {t("update.message", { version: updateInfo.tagName })}
              </Text>

              {/* Snooze Checkbox */}
              <TouchableOpacity
                style={styles.checkboxRow}
                activeOpacity={0.7}
                onPress={() => setDontRemind((prev) => !prev)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: dontRemind }}
                accessibilityLabel={t("update.snoozeLabel")}
                testID="update-snooze-checkbox"
              >
                <View
                  style={[
                    styles.checkboxBox,
                    dontRemind && styles.checkboxBoxChecked,
                  ]}
                >
                  {dontRemind && <Text style={styles.checkmark}>✓</Text>}
                </View>
                <Text style={styles.checkboxLabel}>
                  {t("update.snoozeLabel")}
                </Text>
              </TouchableOpacity>

              {/* Action Buttons */}
              <View style={styles.buttonRow}>
                <TouchableOpacity
                  style={[styles.button, styles.dismissButton]}
                  activeOpacity={0.7}
                  onPress={() => onDismiss(dontRemind)}
                  accessibilityRole="button"
                  accessibilityLabel={t("update.later")}
                  testID="update-later-button"
                >
                  <Text style={styles.dismissText}>{t("update.later")}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.button, styles.updateButton]}
                  activeOpacity={0.7}
                  onPress={onUpdate}
                  accessibilityRole="button"
                  accessibilityLabel={t("update.update")}
                  testID="update-confirm-button"
                >
                  <Text style={styles.updateText}>{t("update.update")}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.65)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  dialogCard: {
    width: "100%",
    maxWidth: 360,
    backgroundColor: "#1A1A2E",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.15)",
    padding: 24,
    alignItems: "center",
    elevation: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
  },
  iconContainer: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "rgba(27, 94, 79, 0.3)",
    borderWidth: 1,
    borderColor: "rgba(76, 175, 80, 0.4)",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 16,
  },
  iconText: {
    fontSize: 26,
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    color: "#FFFFFF",
    marginBottom: 8,
    textAlign: "center",
    letterSpacing: -0.2,
  },
  message: {
    fontSize: 14,
    lineHeight: 20,
    color: "#94A3B8",
    textAlign: "center",
    marginBottom: 20,
  },
  checkboxRow: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "stretch",
    paddingVertical: 8,
    paddingHorizontal: 4,
    marginBottom: 20,
  },
  checkboxBox: {
    width: 20,
    height: 20,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: "#64748B",
    backgroundColor: "transparent",
    justifyContent: "center",
    alignItems: "center",
  },
  checkboxBoxChecked: {
    backgroundColor: "#1B5E4F",
    borderColor: "#4CAF50",
  },
  checkmark: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "bold",
    marginTop: -1,
  },
  checkboxLabel: {
    fontSize: 14,
    color: "#CBD5E1",
    marginLeft: 10,
    fontWeight: "500",
  },
  buttonRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    width: "100%",
    gap: 12,
  },
  button: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 16,
  },
  dismissButton: {
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.15)",
  },
  dismissText: {
    color: "#94A3B8",
    fontSize: 15,
    fontWeight: "600",
  },
  updateButton: {
    backgroundColor: "#1B5E4F",
    borderWidth: 1,
    borderColor: "#4CAF50",
  },
  updateText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "600",
  },
});
