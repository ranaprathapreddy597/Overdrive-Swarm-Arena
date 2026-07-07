import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  SharedValue
} from 'react-native-reanimated';

export interface JoystickProps {
  /** Shared value to output X axis (-1 to 1) */
  joystickX?: SharedValue<number>;
  /** Shared value to output Y axis (-1 to 1) */
  joystickY?: SharedValue<number>;
  size?: number;
  knobSize?: number;
  bottom?: number;
  left?: number;
}

export function Joystick({
  joystickX,
  joystickY,
  size = 140,
  knobSize = 56,
  bottom = 30,
  left = 30
}: JoystickProps) {
  const radius = size / 2;
  const maxTranslation = radius - knobSize / 2;

  // Local visual translations
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const isActive = useSharedValue(0);

  const pan = Gesture.Pan()
    .onBegin(() => {
      'worklet';
      isActive.value = 1;
    })
    .onUpdate((event: any) => {
      'worklet';
      let tx = event.translationX;
      let ty = event.translationY;

      const distance = Math.sqrt(tx * tx + ty * ty);

      if (distance > maxTranslation) {
        tx = (tx / distance) * maxTranslation;
        ty = (ty / distance) * maxTranslation;
      }

      translateX.value = tx;
      translateY.value = ty;

      if (joystickX) joystickX.value = tx / maxTranslation;
      if (joystickY) joystickY.value = ty / maxTranslation;
    })
    .onEnd(() => {
      'worklet';
      isActive.value = 0;
      translateX.value = withSpring(0, { damping: 15, stiffness: 150 });
      translateY.value = withSpring(0, { damping: 15, stiffness: 150 });
      if (joystickX) joystickX.value = 0;
      if (joystickY) joystickY.value = 0;
    });

  const knobStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
    ],
    backgroundColor: isActive.value
      ? 'rgba(0, 255, 238, 0.7)'
      : 'rgba(0, 255, 238, 0.35)',
    shadowOpacity: isActive.value ? 0.8 : 0.3,
  }));

  const baseGlowStyle = useAnimatedStyle(() => ({
    borderColor: isActive.value
      ? 'rgba(0, 255, 238, 0.5)'
      : 'rgba(0, 255, 238, 0.2)',
  }));

  return (
    <Animated.View
      style={[
        styles.container,
        {
          width: size,
          height: size,
          borderRadius: radius,
          bottom,
          left,
        },
        baseGlowStyle,
      ]}
    >
      <GestureDetector gesture={pan}>
        <Animated.View
          style={[
            styles.knob,
            {
              width: knobSize,
              height: knobSize,
              borderRadius: knobSize / 2,
            },
            knobStyle,
          ]}
        />
      </GestureDetector>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    backgroundColor: 'rgba(0, 10, 20, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'rgba(0, 255, 238, 0.2)',
    zIndex: 100,
  },
  knob: {
    position: 'absolute',
    shadowColor: '#00FFEE',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 5,
    borderWidth: 1,
    borderColor: 'rgba(0, 255, 238, 0.4)',
  },
});
