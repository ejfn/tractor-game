import React from "react";
import { render, fireEvent } from "@testing-library/react-native";
import { UpdateModal } from "../../src/components/UpdateModal";
import { AppUpdateInfo } from "../../src/utils/updateService";

// Mock i18next / useTranslation
jest.mock("../../src/hooks/useTranslation", () => ({
  useModalsTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (key === "update.title") return "Update Available";
      if (key === "update.message")
        return `A new version of Tractor (${options?.version}) is available to download.`;
      if (key === "update.snoozeLabel")
        return "Don't remind me again for 7 days";
      if (key === "update.later") return "Later";
      if (key === "update.update") return "Update";
      return key;
    },
  }),
}));

describe("UpdateModal", () => {
  const mockUpdateInfo: AppUpdateInfo = {
    tagName: "v1.4.0",
    version: "1.4.0",
    name: "Tractor v1.4.0",
    releaseUrl: "https://github.com/ejfn/Tractor/releases/latest",
    apkDownloadUrl:
      "https://github.com/ejfn/Tractor/releases/download/v1.4.0/tractor-v1.4.0.apk",
  };

  it("does not render when visible is false", () => {
    const { queryByText } = render(
      <UpdateModal
        visible={false}
        updateInfo={mockUpdateInfo}
        onDismiss={jest.fn()}
        onUpdate={jest.fn()}
      />,
    );
    expect(queryByText("Update Available")).toBeNull();
  });

  it("does not render when updateInfo is null", () => {
    const { queryByText } = render(
      <UpdateModal
        visible={true}
        updateInfo={null}
        onDismiss={jest.fn()}
        onUpdate={jest.fn()}
      />,
    );
    expect(queryByText("Update Available")).toBeNull();
  });

  it("renders correctly when visible and updateInfo is provided", () => {
    const { getByText, getByTestId } = render(
      <UpdateModal
        visible={true}
        updateInfo={mockUpdateInfo}
        onDismiss={jest.fn()}
        onUpdate={jest.fn()}
      />,
    );

    expect(getByText("Update Available")).toBeTruthy();
    expect(
      getByText("A new version of Tractor (v1.4.0) is available to download."),
    ).toBeTruthy();
    expect(getByText("Don't remind me again for 7 days")).toBeTruthy();
    expect(getByTestId("update-later-button")).toBeTruthy();
    expect(getByTestId("update-confirm-button")).toBeTruthy();
  });

  it("calls onDismiss with false when dismissed without checking snooze", () => {
    const onDismissMock = jest.fn();
    const { getByTestId } = render(
      <UpdateModal
        visible={true}
        updateInfo={mockUpdateInfo}
        onDismiss={onDismissMock}
        onUpdate={jest.fn()}
      />,
    );

    fireEvent.press(getByTestId("update-later-button"));
    expect(onDismissMock).toHaveBeenCalledWith(false);
  });

  it("calls onDismiss with true when snooze checkbox is toggled", () => {
    const onDismissMock = jest.fn();
    const { getByTestId } = render(
      <UpdateModal
        visible={true}
        updateInfo={mockUpdateInfo}
        onDismiss={onDismissMock}
        onUpdate={jest.fn()}
      />,
    );

    fireEvent.press(getByTestId("update-snooze-checkbox"));
    fireEvent.press(getByTestId("update-later-button"));
    expect(onDismissMock).toHaveBeenCalledWith(true);
  });

  it("calls onUpdate when update button is pressed", () => {
    const onUpdateMock = jest.fn();
    const { getByTestId } = render(
      <UpdateModal
        visible={true}
        updateInfo={mockUpdateInfo}
        onDismiss={jest.fn()}
        onUpdate={onUpdateMock}
      />,
    );

    fireEvent.press(getByTestId("update-confirm-button"));
    expect(onUpdateMock).toHaveBeenCalled();
  });
});
