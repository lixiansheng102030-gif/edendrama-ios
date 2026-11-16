import { NativeModule, requireNativeModule } from 'expo';

export type OrientationModuleEvents = Record<string, unknown>;

declare class OrientationModule extends NativeModule<OrientationModuleEvents> {
  lockLandscape: () => void;
  lockPortrait: () => void;
  unlock: () => void;
}

// Expo Modules API 从 JSI 加载原生模块对象；安卓端为等价实现，iOS 端由此模块提供。
export default requireNativeModule<OrientationModule>('OrientationModule');
