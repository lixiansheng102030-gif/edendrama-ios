import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, Modal, TextInput,
  Alert, ActivityIndicator, StatusBar, Animated, Linking,
} from 'react-native';
// edges 只有 react-native-safe-area-context 的 SafeAreaView 支持（与钱包 / 个人中心保持一致）
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useI18n } from '../i18n/LanguageContext';
import { useTheme, ThemeColors, THEME_META, ThemeMode } from '../theme/ThemeContext';
import { settingsApi, appApi, API_BASE } from '../api';
import { APP_VERSION_CODE, APP_VERSION_NAME } from '../appVersion';

// 顶部预留状态栏高度（+8 留白），避免标题被手机状态栏挡住，并统一推下
const STATUS_TOP = (StatusBar.currentHeight || 24) + 8;

// 语言选项：short = 每行语言框前方展示的语言简写（EN / ZH / RU / ES）
const LANG_OPTIONS: { key: 'en' | 'zh' | 'ru' | 'es'; labelKey: string; short: string }[] = [
  { key: 'en', labelKey: 'lang.english', short: 'EN' },
  { key: 'zh', labelKey: 'lang.chinese', short: 'ZH' },
  { key: 'ru', labelKey: 'lang.russian', short: 'RU' },
  { key: 'es', labelKey: 'lang.spanish', short: 'ES' },
];

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    center: { flex: 1, backgroundColor: colors.bg, justifyContent: 'center', alignItems: 'center' },
    topBar: {
      flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12,
      paddingTop: STATUS_TOP, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.borderStrong, backgroundColor: colors.elevated,
    },
    // ⑧ 左上角返回符号放大，且与标题靠近
    backBtn: {
      minWidth: 40, minHeight: 44, justifyContent: 'center', alignItems: 'flex-start',
    },
    backText: { color: colors.text, fontSize: 38, lineHeight: 42, fontWeight: '300' },
    topTitle: { color: colors.text, fontSize: 18, fontWeight: 'bold', marginLeft: 2 },
    section: {
      marginHorizontal: 16, marginTop: 16, padding: 14, borderRadius: 12,
      backgroundColor: colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
    },
    sectionTitle: { color: colors.muted, fontSize: 12, fontWeight: 'bold', marginBottom: 10 },
    row: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      minHeight: 50,
    },
    rowLabel: { color: colors.text, fontSize: 15 },
    chevron: { color: colors.muted, fontSize: 18 },
    divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: 4 },

    // ⑥⑦ 可展开的下拉选择：点击标题行做展开 / 收起动作
    dropdownHead: {
      flexDirection: 'row', alignItems: 'center', minHeight: 44,
    },
    dropdownHeadLabel: { color: colors.text, fontSize: 15, fontWeight: '600', flex: 1 },
    dropdownHeadValue: { color: colors.primary, fontSize: 13, fontWeight: 'bold', marginRight: 8 },
    dropdownArrow: {
      color: colors.muted, fontSize: 18, width: 20, textAlign: 'center',
    },
    // 展开面板：高度由 Animated.Value 插值驱动，配合 overflow:hidden 实现真正的展开动画
    dropdownPanel: { overflow: 'hidden' as const },
    panelInner: { paddingTop: 12 },

    // ⑥ 主题：文本选项（两列网格），选中高亮，与语言 / 菜单风格统一
    themeTextItem: {
      width: '48%', flexDirection: 'row', alignItems: 'center', gap: 5,
      minHeight: 44, paddingHorizontal: 10, paddingVertical: 6,
      borderRadius: 10, borderWidth: 1, borderColor: colors.border,
      backgroundColor: colors.surfaceAlt,
    },
    themeTextItemActive: { borderColor: colors.primary, backgroundColor: colors.elevated },
    themeTextName: { color: colors.text, fontSize: 13, flexShrink: 1 },
    themeTextNameActive: { color: colors.primary, fontWeight: 'bold' },

    // ⑦ 语言：每行两种语言（两列），简写标识与语言名靠近
    langGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    langItem: {
      width: '48%', flexDirection: 'row', alignItems: 'center', gap: 5,
      minHeight: 44, paddingHorizontal: 10, paddingVertical: 6,
      borderRadius: 10, borderWidth: 1, borderColor: colors.border,
      backgroundColor: colors.surfaceAlt,
    },
    langItemActive: { borderColor: colors.primary, backgroundColor: colors.elevated },
    langShort: {
      minWidth: 30, height: 26, paddingHorizontal: 5, borderRadius: 6,
      alignItems: 'center', justifyContent: 'center', backgroundColor: colors.borderStrong,
    },
    langShortActive: { backgroundColor: colors.primary },
    langShortText: { color: colors.text, fontSize: 11, fontWeight: 'bold' },
    langShortTextActive: { color: '#fff' },
    langName: { color: colors.text, fontSize: 13, flexShrink: 1 },

    // 修改密码 / 关于 弹窗
    modalOverlay: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'center', padding: 20 },
    modalContent: { backgroundColor: colors.elevated, borderRadius: 16, padding: 20, maxHeight: '80%' },
    modalTitle: { color: colors.text, fontSize: 18, fontWeight: 'bold', marginBottom: 16 },
    modalInput: {
      backgroundColor: colors.bg, color: colors.text, borderRadius: 8,
      paddingHorizontal: 12, paddingVertical: 10, marginBottom: 8, minHeight: 44,
    },
    modalBtn: {
      backgroundColor: colors.primary, paddingVertical: 12, borderRadius: 12,
      alignItems: 'center', justifyContent: 'center', marginTop: 8, minHeight: 44,
    },
    modalBtnText: { color: '#fff', fontWeight: 'bold' },
    aboutText: { color: colors.text, fontSize: 14, lineHeight: 22 },
    aboutLoading: { padding: 20, alignItems: 'center' },
  });

export default function SettingsScreen({ navigation }: any) {
  const { t, lang, setLang, languageSwitchEnabled } = useI18n();
  const { theme, colors, setTheme } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [passOpen, setPassOpen] = useState(false);
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);

  const [aboutOpen, setAboutOpen] = useState(false);
  const [aboutText, setAboutText] = useState('');
  const [aboutLoading, setAboutLoading] = useState(false);

  // ⑥⑦ 外观 / 语言下拉展开状态与动画（0=收起，1=展开）
  const [themeOpen, setThemeOpen] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  const themeAnim = useRef(new Animated.Value(0)).current;
  const langAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(themeAnim, {
      toValue: themeOpen ? 1 : 0, duration: 220, useNativeDriver: false,
    }).start();
  }, [themeOpen, themeAnim]);

  useEffect(() => {
    Animated.timing(langAnim, {
      toValue: langOpen ? 1 : 0, duration: 220, useNativeDriver: false,
    }).start();
  }, [langOpen, langAnim]);

  const themePanelStyle = {
    height: themeAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 224] }),
    opacity: themeAnim,
  };
  const langPanelStyle = {
    height: langAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 126] }),
    opacity: langAnim,
  };

  const currentThemeMeta = THEME_META.find((m) => m.key === theme) || THEME_META[0];
  const currentLangMeta = LANG_OPTIONS.find((o) => o.key === lang) || LANG_OPTIONS[0];

  const openAbout = useCallback(async () => {
    setAboutOpen(true);
    setAboutLoading(true);
    try {
      const res: any = await settingsApi.about().catch(() => ({ about: '' }));
      setAboutText(res?.about || '');
    } catch {
      setAboutText('');
    } finally {
      setAboutLoading(false);
    }
  }, []);

  const handleChangePassword = async () => {
    if (!oldPassword || !newPassword || !confirmPassword) {
      Alert.alert(t('wallet.fillPasswordFields'));
      return;
    }
    if (newPassword !== confirmPassword) {
      Alert.alert(t('wallet.passwordMismatch'));
      return;
    }
    setSaving(true);
    try {
      const token = await AsyncStorage.getItem('user_token');
      const res = await fetch(`${API_BASE}/users/password`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ oldPassword, newPassword }),
      });
      if (res.ok) {
        Alert.alert(t('wallet.passwordUpdated'));
        setOldPassword(''); setNewPassword(''); setConfirmPassword('');
        setPassOpen(false);
      } else {
        const data = await res.json().catch(() => ({}));
        Alert.alert(data.message || t('wallet.updateFailed'));
      }
    } catch {
      Alert.alert(t('wallet.updateFailed'));
    } finally {
      setSaving(false);
    }
  };

  // 检查更新：拉后台已发布版本 → 与本地 versionCode 比较 → 提示下载安装
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const handleCheckUpdate = async () => {
    if (checkingUpdate) return;
    setCheckingUpdate(true);
    try {
      const v: any = await appApi.latest().catch(() => null);
      const serverCode = Number(v?.versionCode) || 0;
      if (serverCode > APP_VERSION_CODE && v?.apkUrl) {
        const absUrl = /^https?:\/\//i.test(v.apkUrl) ? v.apkUrl : `${API_BASE}${v.apkUrl}`;
        Alert.alert(
          t('update.newVersionTitle', { name: v.versionName || String(serverCode) }),
          `${v.changelog ? v.changelog + '\n\n' : ''}${t('update.downloadHint')}`,
          [
            { text: t('wallet.cancel'), style: 'cancel' },
            {
              text: t('update.updateNow'),
              onPress: () => {
                Linking.openURL(absUrl).catch(() =>
                  Alert.alert(t('common.error'), t('update.openFailed')),
                );
              },
            },
          ],
        );
      } else {
        Alert.alert(t('update.latestTitle'), t('update.latestMsg'));
      }
    } catch {
      Alert.alert(t('common.error'), t('update.checkFailed'));
    } finally {
      setCheckingUpdate(false);
    }
  };

  const handleLogout = async () => {
    await AsyncStorage.multiRemove(['user_token', 'user_info', 'guest_mode']);
    navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
  };

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      {/* 顶部栏：放大的返回符号 + 标题（两者靠近） */}
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} activeOpacity={0.7}>
          <Text style={styles.backText}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.topTitle}>{t('profile.settings')}</Text>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 24 }}>
        {/* 外观 / 语言 / 设置菜单：合并为同一个卡片（宽度一致、无卡片缝隙），用分隔线相连 */}
        <View style={styles.section}>
          {/* ⑥ 外观：下拉展开 → 主题文本选项（与语言 / 菜单风格统一） */}
          <TouchableOpacity
            style={styles.dropdownHead}
            onPress={() => setThemeOpen((v) => !v)}
            activeOpacity={0.7}
          >
            <Text style={styles.dropdownHeadLabel}>{t('profile.appearance')}</Text>
            <Text style={styles.dropdownHeadValue}>{t(currentThemeMeta.labelKey)}</Text>
            <Text style={styles.dropdownArrow}>{themeOpen ? '⌄' : '›'}</Text>
          </TouchableOpacity>
          <Animated.View style={[styles.dropdownPanel, themePanelStyle]}>
            <View style={[styles.panelInner, styles.langGrid]}>
              {THEME_META.map((m) => {
                const selected = theme === m.key;
                return (
                  <TouchableOpacity
                    key={m.key}
                    onPress={() => setTheme(m.key as ThemeMode)}
                    style={[styles.themeTextItem, selected && styles.themeTextItemActive]}
                    activeOpacity={0.8}
                  >
                    <Text
                      style={[styles.themeTextName, selected && styles.themeTextNameActive]}
                      numberOfLines={1}
                    >
                      {t(m.labelKey)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </Animated.View>

          <View style={styles.divider} />

          {/* ⑦ 语言：与外观一致的下拉展开；每行两种语言，前方带语言简写（开关关闭时隐藏） */}
          {languageSwitchEnabled && (
            <>
              <TouchableOpacity
                style={styles.dropdownHead}
                onPress={() => setLangOpen((v) => !v)}
                activeOpacity={0.7}
              >
                <Text style={styles.dropdownHeadLabel}>{t('profile.language')}</Text>
                <Text style={styles.dropdownHeadValue}>{currentLangMeta.short} · {t(currentLangMeta.labelKey)}</Text>
                <Text style={styles.dropdownArrow}>{langOpen ? '⌄' : '›'}</Text>
              </TouchableOpacity>
              <Animated.View style={[styles.dropdownPanel, langPanelStyle]}>
                <View style={[styles.panelInner, styles.langGrid]}>
                  {LANG_OPTIONS.map((opt) => {
                    const selected = lang === opt.key;
                    return (
                      <TouchableOpacity
                        key={opt.key}
                        onPress={() => setLang(opt.key)}
                        style={[styles.langItem, selected && styles.langItemActive]}
                        activeOpacity={0.8}
                      >
                        <View style={[styles.langShort, selected && styles.langShortActive]}>
                          <Text style={[styles.langShortText, selected && styles.langShortTextActive]}>
                            {opt.short}
                          </Text>
                        </View>
                        <Text style={styles.langName} numberOfLines={1}>{t(opt.labelKey)}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </Animated.View>
              <View style={styles.divider} />
            </>
          )}

          {/* 设置菜单：交易记录（新入口） / 修改密码 / 购买记录 / 关于 / 退出登录 */}
          <TouchableOpacity
            style={styles.row}
            onPress={() => navigation.navigate('WalletHistory')}
            activeOpacity={0.7}
          >
            <Text style={styles.rowLabel}>{t('wallet.txRecords')}</Text>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>
          <View style={styles.divider} />
          <TouchableOpacity style={styles.row} onPress={() => setPassOpen(true)} activeOpacity={0.7}>
            <Text style={styles.rowLabel}>{t('wallet.changePassword')}</Text>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>
          <View style={styles.divider} />
          <TouchableOpacity
            style={styles.row}
            onPress={() => navigation.navigate('CategoryList', { type: 'purchased' })}
            activeOpacity={0.7}
          >
            <Text style={styles.rowLabel}>{t('profile.purchased')}</Text>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>
          <View style={styles.divider} />
          <TouchableOpacity style={styles.row} onPress={openAbout} activeOpacity={0.7}>
            <Text style={styles.rowLabel}>{t('profile.about')}</Text>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>
          <View style={styles.divider} />
          <TouchableOpacity style={styles.row} onPress={handleCheckUpdate} activeOpacity={0.7}>
            <Text style={styles.rowLabel}>{t('settings.checkUpdate')}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Text style={{ color: colors.muted, fontSize: 13, marginRight: 6 }}>v{APP_VERSION_NAME}</Text>
              {checkingUpdate ? (
                <ActivityIndicator size="small" color={colors.muted} />
              ) : (
                <Text style={styles.chevron}>›</Text>
              )}
            </View>
          </TouchableOpacity>
          <View style={styles.divider} />
          <TouchableOpacity style={styles.row} onPress={handleLogout} activeOpacity={0.7}>
            <Text style={[styles.rowLabel, { color: colors.danger }]}>{t('profile.logout')}</Text>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* 修改密码 Modal */}
      <Modal visible={passOpen} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>{t('wallet.changePassword')}</Text>
            <TextInput
              value={oldPassword} onChangeText={setOldPassword} secureTextEntry
              style={styles.modalInput} placeholder={t('wallet.oldPassword')}
              placeholderTextColor={colors.subtle}
            />
            <TextInput
              value={newPassword} onChangeText={setNewPassword} secureTextEntry
              style={styles.modalInput} placeholder={t('wallet.newPassword')}
              placeholderTextColor={colors.subtle}
            />
            <TextInput
              value={confirmPassword} onChangeText={setConfirmPassword} secureTextEntry
              style={styles.modalInput} placeholder={t('wallet.confirmPassword')}
              placeholderTextColor={colors.subtle}
            />
            <TouchableOpacity onPress={handleChangePassword} disabled={saving}
              style={[styles.modalBtn, { opacity: saving ? 0.5 : 1 }]}>
              <Text style={styles.modalBtnText}>{saving ? t('common.loading') : t('wallet.changePassword')}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setPassOpen(false)} style={{ marginTop: 12, padding: 8 }}>
              <Text style={{ color: colors.muted, textAlign: 'center' }}>{t('wallet.cancel')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* 关于 Modal */}
      <Modal visible={aboutOpen} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>{t('profile.about')}</Text>
            {aboutLoading ? (
              <View style={styles.aboutLoading}>
                <ActivityIndicator color={colors.primary} size="large" />
              </View>
            ) : (
              <ScrollView style={{ maxHeight: 360 }}>
                <Text style={styles.aboutText}>
                  {aboutText || t('profile.aboutDefault')}
                </Text>
              </ScrollView>
            )}
            <TouchableOpacity onPress={() => setAboutOpen(false)} style={{ marginTop: 16, padding: 8 }}>
              <Text style={{ color: colors.muted, textAlign: 'center' }}>{t('wallet.cancel')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
