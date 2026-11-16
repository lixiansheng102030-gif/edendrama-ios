import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  Alert,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { coinApi } from '../api';
import { useI18n } from '../i18n/LanguageContext';
import { useTheme, ThemeColors } from '../theme/ThemeContext';

type UnlockOverlayProps = {
  visible: boolean;
  dramaId: string;
  dramaPrice: number;
  onClose: () => void;
  onUnlocked: () => void;
};

export default function UnlockOverlay({
  visible,
  dramaId,
  dramaPrice,
  onClose,
  onUnlocked,
}: UnlockOverlayProps) {
  const navigation = useNavigation();
  const { t } = useI18n();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [balance, setBalance] = useState<number | null>(null);
  const [unlocking, setUnlocking] = useState(false);
  const [authError, setAuthError] = useState(false);

  const cost = Math.max(0, Math.round(dramaPrice * 100));

  useEffect(() => {
    if (!visible) return;
    setBalance(null);
    setAuthError(false);
    coinApi
      .balance()
      .then((data: any) => {
        // 后端 /coins/balance 返回 { coins }，这里两种字段名都兜住，
        // 否则余额恒为 0，解锁按钮会被误判为"金币不足"而禁用。
        const v = typeof data === 'number' ? data : (data?.coins ?? data?.balance ?? 0);
        setBalance(v);
      })
      .catch((e: any) => {
        if (e?.response?.status === 401) {
          setAuthError(true);
        } else {
          setBalance(0);
        }
      });
  }, [visible, dramaId]);

  const handleUnlock = async () => {
    if (balance === null || balance < cost) {
      Alert.alert(
        t('unlock.insufficientTitle'),
        t('unlock.insufficientMsg'),
      );
      return;
    }
    setUnlocking(true);
    try {
      await coinApi.unlockDrama(dramaId);
      Alert.alert(t('unlock.successTitle'), t('unlock.successMsg'));
      onUnlocked();
    } catch (e: any) {
      if (e?.response?.status === 401) {
        Alert.alert(t('unlock.pleaseLogin'));
        setAuthError(true);
      } else {
        Alert.alert(
          t('unlock.errorTitle'),
          e?.response?.data?.message || t('unlock.failed'),
        );
      }
    } finally {
      setUnlocking(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.modal}>
          <TouchableOpacity
            style={styles.closeBtn}
            onPress={onClose}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={styles.closeText}>{'\u2715'}</Text>
          </TouchableOpacity>

          <Text style={styles.lockIcon}>{'\uD83D\uDD12'}</Text>
          <Text style={styles.title}>{t('unlock.title')}</Text>
          <Text style={styles.subtitle}>{t('unlock.subtitle')}</Text>

          <View style={styles.costRow}>
            <Text style={styles.costLabel}>{t('unlock.cost')}</Text>
            <Text style={styles.costValue}>
              {cost} {t('unlock.coins')}
            </Text>
          </View>

          <View style={styles.balanceRow}>
            <Text style={styles.balanceLabel}>{t('unlock.yourBalance')}</Text>
            <Text
              style={[
                styles.balanceValue,
                balance !== null && balance < cost && { color: colors.danger },
              ]}
            >
              {balance === null ? '...' : balance.toLocaleString()}
            </Text>
          </View>

          {authError && (
            <Text style={styles.loginHint}>{t('unlock.loginHint')}</Text>
          )}

          <TouchableOpacity
            onPress={handleUnlock}
            disabled={unlocking || balance === null || balance < cost}
            style={[
              styles.unlockBtn,
              (unlocking || balance === null || balance < cost) && { opacity: 0.5 },
            ]}
          >
            <Text style={styles.unlockBtnText}>
              {unlocking ? t('unlock.unlocking') : t('unlock.btn', { coins: cost })}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => {
              onClose();
              (navigation as any).navigate('Profile');
            }}
            style={styles.earnLinkBtn}
          >
            <Text style={styles.earnLink}>{t('unlock.earnCoins')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// 主题化样式：随 light/dark 主题动态生成
function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: colors.overlay,
      justifyContent: 'center',
      padding: 24,
    },
    modal: {
      backgroundColor: colors.surface,
      borderRadius: 16,
      padding: 24,
      alignItems: 'center',
      position: 'relative',
    },
    closeBtn: {
      position: 'absolute',
      top: 12,
      right: 12,
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: colors.borderStrong,
      justifyContent: 'center',
      alignItems: 'center',
    },
    closeText: { color: colors.text, fontSize: 14, fontWeight: 'bold' },
    lockIcon: { fontSize: 48, marginBottom: 12 },
    title: { color: colors.text, fontSize: 22, fontWeight: 'bold', textAlign: 'center' },
    subtitle: { color: colors.muted, textAlign: 'center', marginTop: 8, marginBottom: 20 },
    costRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      width: '100%',
      paddingVertical: 8,
    },
    costLabel: { color: colors.muted },
    costValue: { color: colors.gold, fontWeight: 'bold' },
    balanceRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      width: '100%',
      paddingVertical: 8,
      marginBottom: 16,
    },
    balanceLabel: { color: colors.muted },
    balanceValue: { color: colors.text, fontWeight: 'bold' },
    loginHint: { color: colors.danger, marginBottom: 12 },
    unlockBtn: {
      backgroundColor: colors.gold,
      paddingVertical: 14,
      paddingHorizontal: 32,
      borderRadius: 30,
      width: '100%',
      minHeight: 44,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // 金色按钮上的文字保持深色以保证对比度（两种主题下均成立）
    unlockBtnText: { color: '#000', fontWeight: 'bold', fontSize: 16 },
    // 获取金币入口可点区域 ≥44pt
    earnLinkBtn: { marginTop: 12, minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 },
    earnLink: { color: colors.primary, fontWeight: 'bold', marginTop: 4 },
  });
}