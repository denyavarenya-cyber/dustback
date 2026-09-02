import { Pressable, StyleProp, Text, View, ViewStyle } from 'react-native';
import { radius, useTheme } from './theme';

export function Btn(props: {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const { variant = 'primary' } = props;
  const bg =
    variant === 'primary'
      ? t.accent
      : variant === 'danger'
        ? t.danger
        : 'transparent';
  const color = variant === 'secondary' ? t.accent : t.onAccent;
  return (
    <Pressable
      onPress={props.onPress}
      disabled={props.disabled}
      style={({ pressed }) => [
        {
          backgroundColor: bg,
          borderRadius: radius,
          borderWidth: variant === 'secondary' ? 1 : 0,
          borderColor: t.accent,
          paddingVertical: 14,
          alignItems: 'center',
          opacity: props.disabled ? 0.4 : pressed ? 0.75 : 1,
        },
        props.style,
      ]}
    >
      <Text style={{ color, fontSize: 16, fontWeight: '600' }}>
        {props.title}
      </Text>
    </Pressable>
  );
}

export function Card(props: {
  children: React.ReactNode;
  tint?: 'surface' | 'success' | 'danger';
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const bg =
    props.tint === 'success'
      ? t.successTint
      : props.tint === 'danger'
        ? t.dangerBg
        : t.surface;
  return (
    <View
      style={[
        {
          backgroundColor: bg,
          borderRadius: radius,
          borderWidth: 1,
          borderColor: props.tint === 'danger' ? t.danger : t.border,
          padding: 16,
        },
        props.style,
      ]}
    >
      {props.children}
    </View>
  );
}
