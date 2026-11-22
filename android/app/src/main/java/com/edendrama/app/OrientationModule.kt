package com.edendrama.app

import android.app.Activity
import android.content.pm.ActivityInfo
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * 极简屏幕方向控制：进入横屏播放时锁定为横屏，退出时恢复竖屏。
 * 不需要任何新依赖，纯 Android SDK 调用，离线可编译。
 */
class OrientationModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "OrientationModule"

    private fun runOnActivity(block: (Activity) -> Unit) {
        val activity = currentActivity ?: return
        activity.runOnUiThread { block(activity) }
    }

    @ReactMethod
    fun lockLandscape() {
        runOnActivity { it.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE }
    }

    @ReactMethod
    fun lockPortrait() {
        runOnActivity { it.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_PORTRAIT }
    }

    @ReactMethod
    fun unlock() {
        runOnActivity { it.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED }
    }
}
