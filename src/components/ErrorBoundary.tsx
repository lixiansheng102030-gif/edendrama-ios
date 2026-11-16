import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useI18n } from '../i18n/LanguageContext';

interface State {
  hasError: boolean;
  message: string;
}

/**
 * 顶层错误边界：任何页面在渲染期抛出未捕获异常时，
 * 不再让 RN 直接把 App 闪退到桌面，而是展示一个友好的兜底界面 + 重试按钮。
 */
export default class ErrorBoundary extends React.Component<{ children?: React.ReactNode }, State> {
  state: State = { hasError: false, message: '' };

  static getDerivedStateFromError(error: any): Partial<State> {
    return { hasError: true, message: error?.message ? String(error.message) : '' };
  }

  componentDidCatch(error: any, info: any) {
    // 仅本地打印，避免二次抛错
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary]', error, info);
  }

  private handleRetry = () => {
    this.setState({ hasError: false, message: '' });
  };

  render() {
    if (this.state.hasError) {
      return <Fallback message={this.state.message} onRetry={this.handleRetry} />;
    }
    return this.props.children ?? null;
  }
}

function Fallback({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = useI18n();
  return (
    <View style={styles.center}>
      <Text style={styles.emoji}>⚠️</Text>
      <Text style={styles.title}>{t('common.error')}</Text>
      <Text style={styles.msg} numberOfLines={3}>
        {message || t('login.networkError')}
      </Text>
      <TouchableOpacity style={styles.btn} onPress={onRetry} activeOpacity={0.85}>
        <Text style={styles.btnText}>{t('common.retry')}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    backgroundColor: '#0f0f12',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  emoji: { fontSize: 48, marginBottom: 12 },
  title: { color: '#fff', fontSize: 20, fontWeight: 'bold', marginBottom: 8 },
  msg: { color: '#bbb', fontSize: 13, textAlign: 'center', marginBottom: 24, maxWidth: 280 },
  btn: {
    backgroundColor: '#7c3aed',
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 24,
    minHeight: 44,
    justifyContent: 'center',
  },
  btnText: { color: '#fff', fontWeight: 'bold', fontSize: 15 },
});
