import React from 'react';
import { View } from 'react-native';

/**
 * 消息信封简笔画。
 *
 * 项目未安装 `react-native-svg`（且不允许新增原生依赖），所以这里用纯 View 画线条：
 * - 外形：矩形边框（borderWidth + borderRadius）
 * - 信封盖：左上角 → 中心、右上角 → 中心的两条斜线（细长 View + rotate）
 *
 * 颜色由调用方传入（通常传 colors.text），因此浅色 / 深色主题都能跟随。
 */
export default function EnvelopeIcon({
  size = 22,
  color,
  strokeWidth = 1.5,
}: {
  size?: number;
  color: string;
  strokeWidth?: number;
}) {
  // 信封按 22:16 的经典比例
  const w = size;
  const h = Math.round((size * 16) / 22);
  // 信封盖的汇合点（取高度的 55% 处，视觉上更接近真实信封）
  const apexY = h * 0.55;
  // 斜线长度 = 左上角(0,0) 到汇合点(w/2, apexY) 的直线距离
  const lineLength = Math.sqrt((w / 2) * (w / 2) + apexY * apexY);
  // 斜线与水平方向的夹角（度）。RN 的 rotate 正值为顺时针
  const angle = (Math.atan2(apexY, w / 2) * 180) / Math.PI;
  // 斜线以自身中心为旋转轴，所以把中心对准「起点-终点」的中点
  const lineTop = apexY / 2 - strokeWidth / 2;

  return (
    <View
      style={{
        width: w,
        height: h,
        borderWidth: strokeWidth,
        borderColor: color,
        borderRadius: 2,
      }}>
      {/* 左半盖：左上角 → 中心 */}
      <View
        style={{
          position: 'absolute',
          left: w / 4 - lineLength / 2,
          top: lineTop,
          width: lineLength,
          height: strokeWidth,
          backgroundColor: color,
          transform: [{ rotate: `${angle}deg` }],
        }}
      />
      {/* 右半盖：右上角 → 中心 */}
      <View
        style={{
          position: 'absolute',
          left: (3 * w) / 4 - lineLength / 2,
          top: lineTop,
          width: lineLength,
          height: strokeWidth,
          backgroundColor: color,
          transform: [{ rotate: `${-angle}deg` }],
        }}
      />
    </View>
  );
}
