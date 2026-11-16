import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  StyleSheet,
  TextInput,
  ScrollView,
  PanResponder,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { commentApi } from '../api';
import { useI18n } from '../i18n/LanguageContext';
import { useTheme, ThemeColors } from '../theme/ThemeContext';

// 星级文本（半星按实心显示）
function starGlyphs(stars: number): string {
  let out = '';
  for (let i = 0; i < 5; i++) out += stars >= i + 0.5 ? '★' : '☆';
  return out;
}

// 归一化星值（后端 stars 优先，其次 rating 半星单位）
function toStars(item: any): number {
  if (!item) return 0;
  if (typeof item.stars === 'number' && item.stars > 0) return item.stars;
  if (typeof item.rating === 'number' && item.rating > 0) return item.rating / 2;
  return 0;
}

// 日期格式化为 MM-DD
function formatDate(value?: string): string {
  if (!value) return '';
  const d = new Date(value);
  if (isNaN(d.getTime())) return '';
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${mm}-${dd}`;
}

// 星级控件：点击或滑动评分，支持半星（0.5 的倍数）
function StarRating({
  value,
  onChange,
  disabled,
  size = 26,
}: {
  value: number;
  onChange?: (stars: number) => void;
  disabled?: boolean;
  size?: number;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [preview, setPreview] = useState<number | null>(null);
  const widthRef = useRef(0);
  const disabledRef = useRef(disabled);
  const onChangeRef = useRef(onChange);
  disabledRef.current = disabled;
  onChangeRef.current = onChange;

  const shown = preview != null ? preview : value;

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => !disabledRef.current,
        onMoveShouldSetPanResponder: () => !disabledRef.current,
        onPanResponderGrant: (e) => {
          const w = widthRef.current;
          if (!w) return;
          const ratio = Math.min(1, Math.max(0, e.nativeEvent.locationX / w));
          const idx = Math.min(4, Math.floor(ratio * 5));
          const half = ratio * 5 - idx < 0.5 ? 0.5 : 1;
          setPreview(Math.min(5, Math.max(0.5, idx + half)));
        },
        onPanResponderMove: (e) => {
          const w = widthRef.current;
          if (!w) return;
          const ratio = Math.min(1, Math.max(0, e.nativeEvent.locationX / w));
          const idx = Math.min(4, Math.floor(ratio * 5));
          const half = ratio * 5 - idx < 0.5 ? 0.5 : 1;
          setPreview(Math.min(5, Math.max(0.5, idx + half)));
        },
        onPanResponderRelease: (e) => {
          const w = widthRef.current;
          setPreview(null);
          if (!w) return;
          const ratio = Math.min(1, Math.max(0, e.nativeEvent.locationX / w));
          const idx = Math.min(4, Math.floor(ratio * 5));
          const half = ratio * 5 - idx < 0.5 ? 0.5 : 1;
          onChangeRef.current?.(Math.min(5, Math.max(0.5, idx + half)));
        },
        onPanResponderTerminate: () => setPreview(null),
      }),
    [],
  );

  return (
    <View
      style={[styles.starRow, disabled && { opacity: 0.5 }]}
      onLayout={(e) => {
        widthRef.current = e.nativeEvent.layout.width;
      }}
      {...responder.panHandlers}>
      {[0, 1, 2, 3, 4].map((i) => {
        const fill = shown >= i + 1 ? 1 : shown >= i + 0.5 ? 0.5 : 0;
        return (
          <View key={i} style={{ width: size, height: size }}>
            <Text style={[styles.starBase, { fontSize: size }]}>★</Text>
            {fill > 0 && (
              <View
                style={{
                  position: 'absolute',
                  width: size * fill,
                  height: size,
                  overflow: 'hidden',
                }}>
                <Text style={[styles.starFill, { fontSize: size }]}>★</Text>
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}

type Props = {
  dramaId: string;
  dramaTitle: string;
  episodeId?: string; // 评论挂载的集 id（通常传第一集；无分集的预约剧集不传）
};

/**
 * 剧评区块：评分汇总 + 星级评分（点击/滑动）+ 热门剧评横滑；
 * 点击星级或列表进入全屏评论界面，可发表评论、点赞与回复。
 */
export default function ReviewSection({ dramaId, dramaTitle, episodeId }: Props) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [summary, setSummary] = useState<any>(null);
  const [canRate, setCanRate] = useState(false);
  const [pick, setPick] = useState(0);

  const [open, setOpen] = useState(false);
  const [initialRating, setInitialRating] = useState(0);

  // 全屏评论界面状态
  const [list, setList] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [myStars, setMyStars] = useState(0);
  const [content, setContent] = useState('');
  const [rating, setRating] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [replyPosting, setReplyPosting] = useState(false);

  const topComments: any[] = Array.isArray(summary?.topComments) ? summary.topComments : [];
  const commentCount = Number(summary?.commentCount) || 0;

  const loadSummary = async () => {
    try {
      const res: any = await commentApi.summary(dramaId);
      setSummary(res);
    } catch {
      setSummary(null);
    }
  };

  const loadEligibility = async () => {
    const token = await AsyncStorage.getItem('user_token');
    if (!token) {
      setCanRate(false);
      return;
    }
    try {
      const res: any = await commentApi.eligibility(dramaId);
      setCanRate(!!res?.canRate);
    } catch {
      /* ignore */
    }
  };

  const loadList = async () => {
    setLoading(true);
    try {
      const res: any = await commentApi.list({ dramaId, pageSize: 100 });
      setList(Array.isArray(res?.list) ? res.list : []);
      setTotal(Number(res?.total) || 0);
    } catch {
      setList([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSummary();
    loadEligibility();
  }, [dramaId]);

  // 打开评论界面：加载全部评论并预填星值
  const openScreen = (stars: number) => {
    setInitialRating(stars);
    setRating(stars);
    setContent('');
    setReplyingTo(null);
    setOpen(true);
    loadList();
    loadSummary();
    loadEligibility();
  };

  const closeScreen = () => {
    setOpen(false);
    setPick(0);
    loadSummary();
    loadEligibility();
  };

  // 选择星级后直接进入评论界面
  const handlePick = (stars: number) => {
    if (!canRate) return;
    setPick(stars);
    openScreen(stars);
  };

  const toggleLike = async (c: any) => {
    const token = await AsyncStorage.getItem('user_token');
    if (!token) {
      Alert.alert(t('review.needLogin'));
      return;
    }
    const liked = !c.likedByMe;
    const prevLiked = !!c.likedByMe;
    const prevCount = Number(c.likeCount) || 0;
    const patch = (next: Record<string, any>) =>
      setList((prev) => prev.map((x) => (x.id === c.id ? { ...x, ...next } : x)));
    patch({ likedByMe: liked, likeCount: Math.max(0, prevCount + (liked ? 1 : -1)) });
    try {
      const res: any = await commentApi.like(c.id);
      patch({ likedByMe: !!res?.liked, likeCount: Number(res?.likeCount) || 0 });
    } catch {
      patch({ likedByMe: prevLiked, likeCount: prevCount });
    }
  };

  const submitReply = async (parent: any) => {
    const text = replyText.trim();
    if (!text || replyPosting) return;
    const token = await AsyncStorage.getItem('user_token');
    if (!token) {
      Alert.alert(t('review.needLogin'));
      return;
    }
    setReplyPosting(true);
    try {
      const created: any = await commentApi.reply(parent.id, text);
      setList((prev) =>
        prev.map((c) =>
          c.id === parent.id ? { ...c, replies: [...(c.replies || []), created] } : c,
        ),
      );
      setReplyingTo(null);
      setReplyText('');
    } catch {
      /* ignore */
    } finally {
      setReplyPosting(false);
    }
  };

  const submitComment = async () => {
    const text = content.trim();
    if (!text || submitting) return;
    const token = await AsyncStorage.getItem('user_token');
    if (!token) {
      Alert.alert(t('review.needLogin'));
      return;
    }
    setSubmitting(true);
    try {
      // 有分集时挂到分集，无分集（预约剧集）时挂到剧集维度
      const body: any = { content: text };
      if (episodeId) body.episodeId = episodeId;
      else body.dramaId = dramaId;
      if (rating > 0) body.rating = Math.round(rating * 2);
      await commentApi.create(body);
      setContent('');
      await Promise.all([loadList(), loadSummary(), loadEligibility()]);
      Alert.alert(t('review.posted'));
    } catch (e: any) {
      // 服务端 400（如未满观看时长）时提示原因
      const msg = e?.response?.data?.message || t('review.submitFailed');
      Alert.alert(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.wrap}>
      {/* 标题行 */}
      <View style={styles.titleRow}>
        <Text style={styles.title}>{t('review.title', { n: commentCount })}</Text>
        <TouchableOpacity onPress={() => openScreen(0)} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Text style={styles.allLink}>{t('review.all')} ›</Text>
        </TouchableOpacity>
      </View>

      {/* 评分汇总卡：左平均分 / 右星级评分 */}
      <View style={styles.summaryCard}>
        <View>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
            <Text style={styles.avgScore}>{summary?.avgRating ?? 0}</Text>
            <Text style={styles.avgUnit}>{t('review.scoreUnit')}</Text>
          </View>
          <Text style={styles.ratingCount}>
            {t('review.ratingCount', { n: Number(summary?.ratingCount) || 0 })}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={styles.rateHint}>{t('review.rateHint')}</Text>
          <StarRating value={pick} onChange={handlePick} disabled={!canRate} />
          {!canRate && <Text style={styles.notEligible}>{t('review.notEligible')}</Text>}
        </View>
      </View>

      {/* 热门剧评横滑 */}
      {topComments.length === 0 ? (
        <Text style={styles.emptyText}>{t('review.noComments')}</Text>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingVertical: 12 }}>
          {topComments.map((c) => {
            const stars = toStars(c);
            return (
              <TouchableOpacity key={c.id} style={styles.topCard} onPress={() => openScreen(0)}>
                <Text style={styles.topNick} numberOfLines={1}>
                  {c.user?.nickname || '—'}
                </Text>
                {stars > 0 && <Text style={styles.topStars}>{starGlyphs(stars)}</Text>}
                <Text style={styles.topContent} numberOfLines={3}>
                  {c.content}
                </Text>
                <View style={styles.topMeta}>
                  <Text style={styles.topMetaText}>
                    {c.likedByMe ? '♥' : '♡'} {Number(c.likeCount) || 0}
                  </Text>
                  <Text style={styles.topMetaText}>{formatDate(c.createdAt)}</Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}

      {/* 全屏评论界面 */}
      <Modal visible={open} animationType="slide" onRequestClose={closeScreen}>
        <KeyboardAvoidingView
          style={styles.screen}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          {/* 顶部栏：叠加刘海安全区，避免关闭按钮被状态栏遮挡 */}
          <View style={[styles.screenHeader, { paddingTop: insets.top + 12 }]}>
            <TouchableOpacity
              onPress={closeScreen}
              style={styles.screenBack}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
              <Text style={styles.screenBackText}>✕</Text>
            </TouchableOpacity>
            <Text style={styles.screenTitle} numberOfLines={1}>
              {dramaTitle}
            </Text>
            <View style={styles.screenBack} />
          </View>

          {/* 评分卡 */}
          <View style={styles.screenScoreCard}>
            <View>
              <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
                <Text style={styles.avgScore}>{summary?.avgRating ?? 0}</Text>
                <Text style={styles.avgUnit}>{t('review.scoreUnit')}</Text>
              </View>
              <Text style={styles.ratingCount}>
                {t('review.ratingCount', { n: Number(summary?.ratingCount) || 0 })}
              </Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={styles.rateHint}>{t('review.mine')}</Text>
              <StarRating
                value={myStars > 0 ? myStars : rating}
                onChange={(s) => {
                  if (!canRate) return;
                  setRating(s);
                  setMyStars(s);
                }}
                disabled={!canRate}
              />
              {!canRate && <Text style={styles.notEligible}>{t('review.notEligible')}</Text>}
            </View>
          </View>

          {/* 评论列表 */}
          <ScrollView style={styles.screenList} keyboardShouldPersistTaps="handled">
            {loading && list.length === 0 ? (
              <View style={styles.loadingWrap}>
                <ActivityIndicator color={colors.primary} />
              </View>
            ) : list.length === 0 ? (
              <Text style={styles.emptyText}>{t('review.noComments')}</Text>
            ) : (
              list.map((c) => {
                const stars = toStars(c);
                return (
                  <View key={c.id} style={styles.commentItem}>
                    <View style={styles.avatar}>
                      <Text style={styles.avatarText}>
                        {(c.user?.nickname || '?').slice(0, 1)}
                      </Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <View style={styles.commentTopRow}>
                        <Text style={styles.commentNick} numberOfLines={1}>
                          {c.user?.nickname || '—'}
                        </Text>
                        <Text style={styles.commentDate}>{formatDate(c.createdAt)}</Text>
                      </View>
                      {stars > 0 && <Text style={styles.commentStars}>{starGlyphs(stars)}</Text>}
                      <Text style={styles.commentContent}>{c.content}</Text>

                      <View style={styles.commentActions}>
                        <TouchableOpacity
                          style={styles.commentActionBtn}
                          onPress={() => {
                            setReplyingTo(replyingTo === c.id ? null : c.id);
                            setReplyText('');
                          }}>
                          <Text style={styles.commentActionText}>{t('review.reply')}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.commentActionBtn, { marginLeft: 18 }]}
                          onPress={() => toggleLike(c)}>
                          <Text
                            style={[
                              styles.commentActionText,
                              c.likedByMe && { color: colors.danger },
                            ]}>
                            {c.likedByMe ? '♥' : '♡'} {Number(c.likeCount) || 0}
                          </Text>
                        </TouchableOpacity>
                      </View>

                      {Array.isArray(c.replies) && c.replies.length > 0 && (
                        <View style={styles.replyList}>
                          {c.replies.map((r: any) => (
                            <Text key={r.id} style={styles.replyItem}>
                              <Text style={styles.replyNick}>{r.user?.nickname || '—'} </Text>
                              {r.content}
                            </Text>
                          ))}
                        </View>
                      )}

                      {replyingTo === c.id && (
                        <View style={styles.replyComposer}>
                          <TextInput
                            style={styles.replyInput}
                            value={replyText}
                            onChangeText={setReplyText}
                            placeholder={t('review.replyPlaceholder')}
                            placeholderTextColor={colors.muted}
                          />
                          <TouchableOpacity
                            style={[
                              styles.sendBtn,
                              (!replyText.trim() || replyPosting) && { opacity: 0.5 },
                            ]}
                            disabled={!replyText.trim() || replyPosting}
                            onPress={() => submitReply(c)}>
                            <Text style={styles.sendText}>{t('review.publish')}</Text>
                          </TouchableOpacity>
                        </View>
                      )}
                    </View>
                  </View>
                );
              })
            )}
          </ScrollView>

          {/* 撰写区：星级 + 文本 + 发表；叠加底部安全区，避免输入框贴底被手势条遮挡 */}
          <View style={[styles.composer, { paddingBottom: insets.bottom + 12 }]}>
            <StarRating
              value={rating}
              onChange={(s) => canRate && setRating(s)}
              disabled={!canRate}
              size={22}
            />
            <View style={styles.composerRow}>
              <TextInput
                style={styles.composerInput}
                value={content}
                onChangeText={(v) => setContent(v.slice(0, 1000))}
                placeholder={t('review.commentPlaceholder')}
                placeholderTextColor={colors.muted}
                multiline
                maxLength={1000}
              />
              <TouchableOpacity
                style={[styles.sendBtn, (!content.trim() || submitting) && { opacity: 0.5 }]}
                disabled={!content.trim() || submitting}
                onPress={submitComment}>
                <Text style={styles.sendText}>{t('review.publish')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

// 主题化样式：随 light/dark 主题动态生成
function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    wrap: { marginTop: 8, marginBottom: 16 },
    titleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 12,
    },
    title: { color: colors.text, fontSize: 18, fontWeight: 'bold' },
    allLink: { color: colors.primary, fontSize: 13, fontWeight: '600' },
    summaryCard: {
      backgroundColor: colors.surface,
      borderRadius: 16,
      padding: 16,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    avgScore: { color: colors.text, fontSize: 32, fontWeight: 'bold' },
    avgUnit: { color: colors.muted, fontSize: 13, marginLeft: 4, marginBottom: 4 },
    ratingCount: { color: colors.subtle, fontSize: 12, marginTop: 4 },
    rateHint: { color: colors.subtle, fontSize: 12, marginBottom: 4 },
    notEligible: { color: colors.subtle, fontSize: 11, marginTop: 4, maxWidth: 170, textAlign: 'right' },
    starRow: { flexDirection: 'row' },
    starBase: { color: colors.borderStrong, position: 'absolute' },
    starFill: { color: colors.gold },
    emptyText: { color: colors.subtle, fontSize: 13, textAlign: 'center', paddingVertical: 24 },
    topCard: {
      width: 240,
      backgroundColor: colors.surface,
      borderRadius: 16,
      padding: 12,
      marginRight: 12,
    },
    topNick: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
    topStars: { color: colors.gold, fontSize: 12, marginTop: 2 },
    topContent: { color: colors.textSecondary, fontSize: 13, marginTop: 6, lineHeight: 18 },
    topMeta: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginTop: 10,
    },
    topMetaText: { color: colors.muted, fontSize: 11 },
    // 全屏评论界面
    screen: { flex: 1, backgroundColor: colors.bg },
    screenHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 12,
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    screenBack: { width: 36, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
    screenBackText: { color: colors.text, fontSize: 18 },
    screenTitle: { flex: 1, color: colors.text, fontSize: 16, fontWeight: 'bold', textAlign: 'center' },
    screenScoreCard: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: 16,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    screenList: { flex: 1, paddingHorizontal: 16 },
    loadingWrap: { alignItems: 'center', paddingVertical: 40 },
    commentItem: {
      flexDirection: 'row',
      paddingVertical: 14,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    avatar: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: colors.surfaceAlt,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 10,
    },
    avatarText: { color: colors.textSecondary, fontSize: 14 },
    commentTopRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    commentNick: { color: colors.textSecondary, fontSize: 13, fontWeight: '600', flexShrink: 1 },
    commentDate: { color: colors.subtle, fontSize: 11, marginLeft: 8 },
    commentStars: { color: colors.gold, fontSize: 12, marginTop: 2 },
    commentContent: { color: colors.textSecondary, fontSize: 13, marginTop: 6, lineHeight: 19 },
    commentActions: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      alignItems: 'center',
      marginTop: 6,
    },
    // 回复/点赞可点区域 ≥44pt
    commentActionBtn: { minHeight: 44, justifyContent: 'center' },
    commentActionText: { color: colors.muted, fontSize: 12 },
    replyList: {
      marginTop: 8,
      paddingLeft: 10,
      borderLeftWidth: StyleSheet.hairlineWidth,
      borderLeftColor: colors.borderStrong,
    },
    replyItem: { color: colors.textSecondary, fontSize: 12, lineHeight: 18, marginBottom: 4 },
    replyNick: { color: colors.textSecondary, fontWeight: '600' },
    replyComposer: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
    replyInput: {
      flex: 1,
      backgroundColor: colors.surfaceAlt,
      borderRadius: 18,
      paddingHorizontal: 14,
      paddingVertical: 8,
      color: colors.text,
      fontSize: 13,
    },
    sendBtn: {
      backgroundColor: colors.primary,
      borderRadius: 18,
      minHeight: 44,
      justifyContent: 'center',
      paddingHorizontal: 16,
      paddingVertical: 9,
      marginLeft: 8,
    },
    sendText: { color: colors.text, fontSize: 13, fontWeight: 'bold' },
    composer: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
      paddingHorizontal: 16,
      paddingTop: 10,
      paddingBottom: 20,
      backgroundColor: colors.elevated,
    },
    composerRow: { flexDirection: 'row', alignItems: 'flex-end', marginTop: 8 },
    composerInput: {
      flex: 1,
      minHeight: 44,
      maxHeight: 110,
      backgroundColor: colors.surfaceAlt,
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 10,
      color: colors.text,
      fontSize: 13,
    },
  });
}