import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { testOpenRouterConnection } from "../ai/llm/llmAIClient";
import { gameLogger } from "../utils/gameLogger";
import { DEFAULT_LLM_CONFIG, LLMConfig } from "../ai/llm/llmConfig";
import {
  DEFAULT_MODEL,
  DEFAULT_MODEL_ID,
  DEFAULT_MODEL_SENTINEL,
  isDefaultModelSelection,
  isValidOpenRouterModelId,
  resolveOpenRouterModelId,
} from "../ai/llm/llmModels";
import { useModalsTranslation } from "../hooks/useTranslation";

// ─── Props ───────────────────────────────────────────────────────────────────

interface AIConfigModalProps {
  visible: boolean;
  currentConfig: LLMConfig;
  onSave: (config: LLMConfig) => void;
  onClose: () => void;
}

// ─── Connection status types ─────────────────────────────────────────────────

type ConnectionStatus =
  | { kind: "idle" }
  | { kind: "testing" }
  | { kind: "success"; message: string }
  | { kind: "error"; message: string };

// ─── Model autocomplete config ──────────────────────────────────────────────
// OpenRouter's /models endpoint has no limit/page param, so `q` returns every
// match; we cap client-side and rely on sort=most-popular for ranking.
const MIN_AUTOCOMPLETE_CHARS = 3;
const MAX_AUTOCOMPLETE_SUGGESTIONS = 5;
const AUTOCOMPLETE_DEBOUNCE_MS = 500;

// ─── Component ───────────────────────────────────────────────────────────────

const AIConfigModal: React.FC<AIConfigModalProps> = ({
  visible,
  currentConfig,
  onSave,
  onClose,
}) => {
  const { t } = useModalsTranslation();
  const [useLLM, setUseLLM] = useState(currentConfig.enabled);
  const [selectionMode, setSelectionMode] = useState<"default" | "custom">(
    isDefaultModelSelection(currentConfig.model) ? "default" : "custom",
  );
  const [customModel, setCustomModel] = useState(
    isDefaultModelSelection(currentConfig.model) ? "" : currentConfig.model,
  );
  const [apiKey, setApiKey] = useState(currentConfig.apiKey || "");
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>({
    kind: "idle",
  });
  const scrollViewRef = useRef<ScrollView>(null);

  // Autocomplete model suggestions (fetched per-query from OpenRouter)
  const [filteredSuggestions, setFilteredSuggestions] = useState<
    { id: string; name: string }[]
  >([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  // Last id the user picked from the dropdown. Used to suppress auto-show for
  // the fetch that the selection itself retriggered (selecting sets the field
  // to a valid ≥3-char query), so the dropdown doesn't re-pop right after pick.
  const lastSelectedRef = useRef<string | null>(null);

  // Server-side autocomplete: query OpenRouter's models API as the user types.
  // - 500ms debounce (mobile typing cadence; cuts network calls per burst to ~1)
  // - Min 3 chars before firing (avoids short-prefix noise / huge result sets)
  // - AbortController aborts superseded in-flight requests so a slow earlier
  //   response can't overwrite a fresh one (stale-result race)
  // - sort=most-popular ranks canonical variants on top; input_modalities=text
  //   keeps text-input models; supported_parameters=response_format keeps only
  //   models that support JSON mode, which llmAIClient relies on for every move
  // - Sends the api key (Bearer) — the /models endpoint is public but
  //   unauthenticated requests hit a tight per-IP rate limit; after a few
  //   queries OpenRouter starts rejecting them, which is why the dropdown
  //   "works then suddenly stops". Authenticated requests get a higher quota.
  // - Best-effort: failures are logged but otherwise ignored.
  useEffect(() => {
    const query = customModel.trim();
    if (query.length < MIN_AUTOCOMPLETE_CHARS) {
      setFilteredSuggestions([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      const url = `https://openrouter.ai/api/v1/models?sort=most-popular&input_modalities=text&supported_parameters=response_format&q=${encodeURIComponent(
        query,
      )}`;
      gameLogger.info(
        "llm.autocomplete",
        { query, hasApiKey: Boolean(apiKey) },
        `Requesting OpenRouter models`,
      );
      fetch(url, {
        signal: controller.signal,
        headers: apiKey
          ? {
              Authorization: `Bearer ${apiKey}`,
              "HTTP-Referer": "https://github.com/ejfn/tractor-game",
              "X-Title": "Tractor Shengji AI",
            }
          : undefined,
      })
        .then((res) => {
          if (!res.ok) {
            gameLogger.warn(
              "llm.autocomplete",
              { status: res.status, query },
              `OpenRouter models request failed`,
            );
            return null;
          }
          return res.json();
        })
        .then((json) => {
          if (!json || !Array.isArray(json.data)) {
            return;
          }
          const list = json.data
            .map((m: { id: string; name?: string }) => ({
              id: m.id,
              name: m.name || m.id,
            }))
            .slice(0, MAX_AUTOCOMPLETE_SUGGESTIONS);
          gameLogger.info(
            "llm.autocomplete",
            { query, count: list.length, first: list[0]?.id },
            `OpenRouter models response`,
          );
          setFilteredSuggestions(list);
          // Auto-show on a real typing fetch. Skip the echo of a selection:
          // picking an item sets the field to that id (a valid ≥3-char query),
          // which retriggers this effect — we don't want the dropdown to
          // re-pop immediately after the user just dismissed it.
          if (query !== lastSelectedRef.current) {
            setShowSuggestions(true);
          }
        })
        .catch((err) => {
          if (err?.name === "AbortError") return;
          gameLogger.warn(
            "llm.autocomplete",
            { query, message: String(err?.message || err) },
            `OpenRouter models request error`,
          );
        });
    }, AUTOCOMPLETE_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [customModel, apiKey]);

  // The value persisted to config: sentinel for Default, custom id otherwise.
  const storedModel =
    selectionMode === "default" ? DEFAULT_MODEL_SENTINEL : customModel.trim();
  // Concrete OpenRouter id used for the connectivity test (and at play time).
  const resolvedModel = resolveOpenRouterModelId(storedModel);
  // Display label for the Default card + success banner, e.g. "Default (Gemini 3.1 Flash Lite)".
  const defaultModelLabel = t("aiConfig.llm.defaultModelName", {
    modelName: DEFAULT_MODEL.displayName,
  });

  // Sync local state when the modal opens (handles mid-game reopen)
  useEffect(() => {
    if (visible) {
      const isDefault = isDefaultModelSelection(currentConfig.model);
      setUseLLM(currentConfig.enabled);
      setSelectionMode(isDefault ? "default" : "custom");
      setCustomModel(isDefault ? "" : currentConfig.model);
      setApiKey(currentConfig.apiKey || "");
      setConnectionStatus({ kind: "idle" });
      setShowSuggestions(false);
      setFilteredSuggestions([]);
      lastSelectedRef.current = null;
    }
  }, [visible, currentConfig]);

  // ── Mode toggle ────────────────────────────────────────────────────────────

  const handleModeToggle = useCallback((llmMode: boolean) => {
    setUseLLM(llmMode);
    // Reset connection status on mode switch
    setConnectionStatus({ kind: "idle" });
  }, []);

  // ── Save & Verify ──────────────────────────────────────────────────────────

  const handleSave = useCallback(async () => {
    if (!useLLM) {
      onSave({
        ...DEFAULT_LLM_CONFIG,
        enabled: false,
        apiKey: apiKey.trim(),
        model: storedModel,
      });
      return;
    }

    if (!apiKey.trim()) {
      setConnectionStatus({
        kind: "error",
        message: t("aiConfig.llm.enterKeyError"),
      });
      return;
    }

    // Validate custom model id before hitting the network.
    if (selectionMode === "custom" && !isValidOpenRouterModelId(customModel)) {
      setConnectionStatus({
        kind: "error",
        message: t("aiConfig.llm.customModelError"),
      });
      return;
    }

    setConnectionStatus({ kind: "testing" });

    const result = await testOpenRouterConnection(
      apiKey.trim(),
      resolvedModel,
      DEFAULT_LLM_CONFIG.apiUrl,
    );

    if (result.success) {
      setConnectionStatus({
        kind: "success",
        message: t("aiConfig.llm.connectedMsg", {
          modelName:
            selectionMode === "default"
              ? defaultModelLabel
              : customModel.trim(),
        }),
      });
      onSave({
        ...DEFAULT_LLM_CONFIG,
        enabled: true,
        apiKey: apiKey.trim(),
        model: storedModel,
      });
    } else {
      setConnectionStatus({
        kind: "error",
        message: t("aiConfig.llm.connectionError", {
          error: result.message,
        }),
      });
    }
  }, [
    useLLM,
    apiKey,
    selectionMode,
    customModel,
    storedModel,
    resolvedModel,
    defaultModelLabel,
    onSave,
    t,
  ]);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent={true}
    >
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          {/* ── Header ── */}
          <View style={styles.header}>
            <Text style={styles.headerEmoji}>🤖</Text>
            <Text style={styles.headerTitle}>{t("aiConfig.title")}</Text>
            <Text style={styles.headerSubtitle}>{t("aiConfig.subtitle")}</Text>
          </View>

          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : "height"}
            style={{ flex: 1 }}
          >
            <ScrollView
              ref={scrollViewRef}
              style={styles.body}
              contentContainerStyle={styles.bodyContent}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="always"
            >
              {/* ── Mode Segmented Control ── */}
              <View style={styles.segmentWrapper}>
                <TouchableOpacity
                  style={[
                    styles.segment,
                    styles.segmentLeft,
                    !useLLM && styles.segmentActive,
                  ]}
                  onPress={() => handleModeToggle(false)}
                  activeOpacity={0.8}
                >
                  <Text style={styles.segmentIcon}>⚡</Text>
                  <Text
                    style={[
                      styles.segmentText,
                      !useLLM && styles.segmentTextActive,
                    ]}
                  >
                    {t("aiConfig.modes.algorithmic")}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.segment,
                    styles.segmentRight,
                    useLLM && styles.segmentActiveLLM,
                  ]}
                  onPress={() => handleModeToggle(true)}
                  activeOpacity={0.8}
                >
                  <Text style={styles.segmentIcon}>🧠</Text>
                  <Text
                    style={[
                      styles.segmentText,
                      useLLM && styles.segmentTextActive,
                    ]}
                  >
                    {t("aiConfig.modes.llm")}
                  </Text>
                </TouchableOpacity>
              </View>

              {/* ── Algorithmic mode description ── */}
              {!useLLM && (
                <View style={styles.algoCard}>
                  <View style={styles.algoHeaderRow}>
                    <Text style={styles.algoHeaderIcon}>📐</Text>
                    <Text style={styles.algoTitle}>
                      {t("aiConfig.algorithmic.title")}
                    </Text>
                  </View>
                  <Text style={styles.algoDescription}>
                    {t("aiConfig.algorithmic.description")}
                  </Text>
                  <View style={styles.algoFeaturesList}>
                    {[
                      {
                        label: t("aiConfig.algorithmic.instantTitle"),
                        desc: t("aiConfig.algorithmic.instantDesc"),
                      },
                      {
                        label: t("aiConfig.algorithmic.freeTitle"),
                        desc: t("aiConfig.algorithmic.freeDesc"),
                      },
                      {
                        label: t("aiConfig.algorithmic.offlineTitle"),
                        desc: t("aiConfig.algorithmic.offlineDesc"),
                      },
                    ].map((f) => (
                      <View key={f.label} style={styles.algoFeatureItem}>
                        <Text style={styles.algoFeatureCheck}>✓</Text>
                        <View style={styles.algoFeatureTextContainer}>
                          <Text style={styles.algoFeatureTitle}>{f.label}</Text>
                          <Text style={styles.algoFeatureDesc}>{f.desc}</Text>
                        </View>
                      </View>
                    ))}
                  </View>
                </View>
              )}

              {/* ── LLM panel ── */}
              {useLLM && (
                <View style={styles.llmPanel}>
                  {/* API Key */}
                  <Text style={styles.sectionLabel}>
                    {t("aiConfig.llm.apiKeyLabel")}
                  </Text>
                  <View style={styles.apiKeyRow}>
                    <TextInput
                      style={styles.apiKeyInput}
                      value={apiKey}
                      onChangeText={(v) => {
                        setApiKey(v);
                        // Reset connection status if user edits the key
                        if (connectionStatus.kind !== "idle") {
                          setConnectionStatus({ kind: "idle" });
                        }
                      }}
                      placeholder="sk-or-v1-…"
                      placeholderTextColor="#9CA3AF"
                      secureTextEntry
                      autoCapitalize="none"
                      autoCorrect={false}
                      spellCheck={false}
                    />
                  </View>

                  <Text style={styles.apiKeyHint}>
                    {t("aiConfig.llm.apiKeyHint").split("openrouter.ai")[0]}
                    <Text style={styles.apiKeyHintLink}>openrouter.ai</Text>
                    {t("aiConfig.llm.apiKeyHint").split("openrouter.ai")[1] ||
                      ""}
                  </Text>

                  {/* Model selection: Default vs Custom */}
                  <Text style={styles.sectionLabel}>
                    {t("aiConfig.llm.selectModelLabel")}
                  </Text>

                  {/* Default card */}
                  <TouchableOpacity
                    style={[
                      styles.modelCard,
                      selectionMode === "default" && styles.modelCardSelected,
                    ]}
                    onPress={() => {
                      setSelectionMode("default");
                      setConnectionStatus({ kind: "idle" });
                    }}
                    activeOpacity={0.75}
                  >
                    <View style={styles.modelCardHeader}>
                      <Text style={styles.modelIcon}>✨</Text>
                      <View style={styles.modelNameBlock}>
                        <Text style={styles.modelName}>
                          {defaultModelLabel}
                        </Text>
                      </View>
                      {selectionMode === "default" && (
                        <View style={styles.selectedCheck}>
                          <Text style={styles.selectedCheckText}>✓</Text>
                        </View>
                      )}
                    </View>
                    <Text style={styles.modelDescription}>
                      {t("aiConfig.llm.defaultModelDesc")}
                    </Text>
                    <View style={styles.pricingRow}>
                      <Text style={styles.pricingLabel}>
                        {DEFAULT_MODEL.inputPrice}
                        <Text style={styles.pricingUnit}> in</Text>
                      </Text>
                      <Text style={styles.pricingDivider}>/</Text>
                      <Text style={styles.pricingLabel}>
                        {DEFAULT_MODEL.outputPrice}
                        <Text style={styles.pricingUnit}> out</Text>
                      </Text>
                      <Text style={styles.pricingUnit}> per 1M tokens</Text>
                    </View>
                    <Text style={styles.modelIdMono}>{DEFAULT_MODEL_ID}</Text>
                  </TouchableOpacity>

                  {/* Custom card */}
                  <TouchableOpacity
                    style={[
                      styles.modelCard,
                      selectionMode === "custom" && styles.modelCardSelected,
                    ]}
                    onPress={() => {
                      setSelectionMode("custom");
                      setConnectionStatus({ kind: "idle" });
                    }}
                    activeOpacity={selectionMode === "custom" ? 1 : 0.75}
                  >
                    <View style={styles.modelCardHeader}>
                      <Text style={styles.modelIcon}>⚙️</Text>
                      <View style={styles.modelNameBlock}>
                        <Text style={styles.modelName}>
                          {t("aiConfig.llm.customModelName")}
                        </Text>
                      </View>
                      {selectionMode === "custom" && (
                        <View style={styles.selectedCheck}>
                          <Text style={styles.selectedCheckText}>✓</Text>
                        </View>
                      )}
                    </View>
                    <Text style={styles.modelDescription}>
                      {t("aiConfig.llm.customModelDesc")}
                    </Text>

                    {selectionMode === "custom" && (
                      <View style={{ width: "100%" }}>
                        <TextInput
                          style={styles.customModelInput}
                          value={customModel}
                          onChangeText={(v) => {
                            setCustomModel(v);
                            if (connectionStatus.kind !== "idle") {
                              setConnectionStatus({ kind: "idle" });
                            }
                          }}
                          placeholder={t("aiConfig.llm.customModelPlaceholder")}
                          placeholderTextColor="#9CA3AF"
                          autoCapitalize="none"
                          autoCorrect={false}
                          spellCheck={false}
                          onFocus={() => {
                            setShowSuggestions(true);
                            setTimeout(() => {
                              scrollViewRef.current?.scrollToEnd({
                                animated: true,
                              });
                            }, 100);
                          }}
                        />

                        {showSuggestions && filteredSuggestions.length > 0 && (
                          <View style={styles.suggestionsContainer}>
                            {filteredSuggestions.map((item) => (
                              <TouchableOpacity
                                key={item.id}
                                style={styles.suggestionItem}
                                // Use onPress (not onPressIn): onPress fires only for a
                                // genuine tap, so a finger-down that turns into a drag is
                                // not treated as a selection.
                                onPress={() => {
                                  lastSelectedRef.current = item.id;
                                  setCustomModel(item.id);
                                  setShowSuggestions(false);
                                }}
                              >
                                <Text
                                  style={styles.suggestionName}
                                  pointerEvents="none"
                                >
                                  {item.name}
                                </Text>
                                <Text
                                  style={styles.suggestionId}
                                  pointerEvents="none"
                                >
                                  {item.id}
                                </Text>
                              </TouchableOpacity>
                            ))}
                          </View>
                        )}
                      </View>
                    )}
                  </TouchableOpacity>
                </View>
              )}
            </ScrollView>

            {/* ── Connection status banner (outside scroll) ── */}
            {useLLM && connectionStatus.kind === "success" && (
              <View style={styles.bannerSuccess}>
                <Text style={styles.bannerText}>
                  {connectionStatus.message}
                </Text>
              </View>
            )}
            {useLLM && connectionStatus.kind === "error" && (
              <View style={styles.bannerError}>
                <Text style={styles.bannerText}>
                  {connectionStatus.message}
                </Text>
              </View>
            )}

            {/* ── Footer buttons ── */}
            <View style={styles.footer}>
              <TouchableOpacity
                style={[styles.footerBtn, styles.cancelBtn]}
                onPress={onClose}
                activeOpacity={0.8}
              >
                <Text style={styles.cancelBtnText}>
                  {t("aiConfig.buttons.cancel")}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.footerBtn,
                  styles.saveBtn,
                  connectionStatus.kind === "testing" && styles.saveBtnDisabled,
                ]}
                onPress={handleSave}
                disabled={connectionStatus.kind === "testing"}
                activeOpacity={0.8}
              >
                {connectionStatus.kind === "testing" ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.saveBtnText}>
                    {useLLM
                      ? t("aiConfig.buttons.verifyAndSave")
                      : t("aiConfig.buttons.save")}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </View>
      </View>
    </Modal>
  );
};

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // Overlay
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    alignItems: "center",
  },
  sheet: {
    width: "92%",
    maxWidth: 420,
    height: "88%",
    backgroundColor: "#0F0F1A",
    borderRadius: 20,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.5,
    shadowRadius: 24,
    elevation: 16,
  },

  // Header
  header: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    backgroundColor: "#1A1A2E",
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.08)",
  },
  headerEmoji: { fontSize: 22, marginBottom: 2 },
  headerTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#F1F5F9",
    letterSpacing: 0.3,
  },
  headerSubtitle: {
    marginTop: 4,
    fontSize: 11,
    color: "#94A3B8",
    textAlign: "center",
  },

  // Body
  body: { flex: 1 },
  bodyContent: { padding: 14, paddingBottom: 6 },

  // Segmented control
  segmentWrapper: {
    flexDirection: "row",
    backgroundColor: "#1E1E30",
    borderRadius: 12,
    padding: 3,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.07)",
  },
  segment: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    borderRadius: 10,
    gap: 6,
  },
  segmentLeft: { marginRight: 2 },
  segmentRight: { marginLeft: 2 },
  segmentActive: {
    backgroundColor: "#FFC107",
    shadowColor: "#FFC107",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 6,
    elevation: 4,
  },
  segmentActiveLLM: {
    backgroundColor: "#7B1FA2",
    shadowColor: "#7B1FA2",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.5,
    shadowRadius: 8,
    elevation: 4,
  },
  segmentIcon: { fontSize: 16 },
  segmentText: { fontSize: 14, fontWeight: "600", color: "#64748B" },
  segmentTextActive: { color: "#FFFFFF" },

  // Algorithmic mode card
  algoCard: {
    backgroundColor: "rgba(30, 30, 48, 0.45)",
    borderRadius: 18,
    padding: 20,
    borderWidth: 1,
    borderColor: "rgba(255, 193, 7, 0.22)",
    marginTop: 4,
    shadowColor: "#FFC107",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.05,
    shadowRadius: 16,
    elevation: 4,
  },
  algoHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 10,
    gap: 8,
  },
  algoHeaderIcon: {
    fontSize: 20,
  },
  algoTitle: {
    fontSize: 15,
    fontWeight: "800",
    color: "#FFD54F",
    letterSpacing: 0.5,
  },
  algoDescription: {
    fontSize: 13,
    color: "#94A3B8",
    lineHeight: 19,
    marginBottom: 16,
  },
  algoFeaturesList: {
    gap: 10,
  },
  algoFeatureItem: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255, 193, 7, 0.03)",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255, 193, 7, 0.08)",
    gap: 12,
  },
  algoFeatureCheck: {
    color: "#FFC107",
    fontSize: 15,
    fontWeight: "900",
  },
  algoFeatureTextContainer: {
    flex: 1,
  },
  algoFeatureTitle: {
    fontSize: 12,
    color: "#F1F5F9",
    fontWeight: "700",
    marginBottom: 1,
  },
  algoFeatureDesc: {
    fontSize: 11,
    color: "#64748B",
    fontWeight: "500",
  },

  // LLM panel
  llmPanel: {},

  // API key
  sectionLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: "#94A3B8",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 8,
    marginTop: 4,
  },
  apiKeyRow: { marginBottom: 6 },
  apiKeyInput: {
    backgroundColor: "#1E1E30",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    color: "#F1F5F9",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    fontFamily: "monospace",
  },
  apiKeyHint: { fontSize: 12, color: "#64748B", marginBottom: 16 },
  apiKeyHintLink: { color: "#AB47BC", fontWeight: "600" },

  // Model cards
  modelCard: {
    backgroundColor: "#1E1E30",
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.07)",
  },
  modelCardSelected: {
    borderColor: "#7B1FA2",
    backgroundColor: "rgba(123,31,162,0.12)",
  },
  modelCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 6,
  },
  modelIcon: { fontSize: 20, marginRight: 10 },
  modelNameBlock: { flex: 1 },
  modelName: {
    fontSize: 14,
    fontWeight: "700",
    color: "#F1F5F9",
    marginBottom: 3,
  },
  rankBadge: {
    alignSelf: "flex-start",
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  rankBadgeText: { fontSize: 10, fontWeight: "700" },
  selectedCheck: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "#7B1FA2",
    alignItems: "center",
    justifyContent: "center",
  },
  selectedCheckText: { color: "#fff", fontSize: 12, fontWeight: "800" },
  modelDescription: {
    fontSize: 12,
    color: "#94A3B8",
    lineHeight: 17,
    marginBottom: 8,
  },
  pricingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  pricingLabel: { fontSize: 12, fontWeight: "700", color: "#CBD5E1" },
  pricingDivider: { fontSize: 12, color: "#475569" },
  pricingUnit: { fontSize: 11, color: "#64748B", fontWeight: "400" },
  modelIdMono: {
    fontSize: 11,
    color: "#64748B",
    fontFamily: "monospace",
    marginTop: 6,
  },
  customModelInput: {
    marginTop: 10,
    backgroundColor: "#0F0F1A",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    color: "#F1F5F9",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    fontFamily: "monospace",
  },
  suggestionsContainer: {
    backgroundColor: "#1E1E30",
    borderRadius: 8,
    marginTop: 4,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    zIndex: 10,
    // No maxHeight/overflow:hidden: we hard-cap at MAX_AUTOCOMPLETE_SUGGESTIONS
    // (5) client-side, so the container is bounded by its children and all rows
    // render fully. A fixed maxHeight was clipping the last row.
  },
  suggestionItem: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.05)",
  },
  suggestionName: {
    color: "#F1F5F9",
    fontSize: 13,
    fontWeight: "600",
  },
  suggestionId: {
    color: "#94A3B8",
    fontSize: 11,
    marginTop: 2,
    fontFamily: Platform.OS === "ios" ? "Courier New" : "monospace",
  },

  // (test button removed — merged into footer)

  // Status banners (rendered outside scroll, above footer)
  bannerSuccess: {
    backgroundColor: "rgba(16,185,129,0.15)",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: "rgba(16,185,129,0.4)",
  },
  bannerError: {
    backgroundColor: "rgba(239,68,68,0.12)",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: "rgba(239,68,68,0.35)",
  },
  bannerText: { fontSize: 13, color: "#F1F5F9", lineHeight: 18 },

  // Footer
  footer: {
    flexDirection: "row",
    padding: 12,
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.07)",
    backgroundColor: "#1A1A2E",
  },
  footerBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  cancelBtn: {
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  cancelBtnText: { color: "#94A3B8", fontSize: 13, fontWeight: "600" },
  saveBtn: { backgroundColor: "#7B1FA2" },
  saveBtnDisabled: { backgroundColor: "#4A1A6A", opacity: 0.6 },
  saveBtnText: { color: "#fff", fontSize: 13, fontWeight: "700" },
});

export default AIConfigModal;
