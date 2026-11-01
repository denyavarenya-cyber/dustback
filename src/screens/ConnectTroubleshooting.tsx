import { Platform, Pressable, Text, View } from 'react-native';
import { useTheme } from '../theme';
import { Btn, Card } from '../ui';

export type VendorKind = 'xiaomi' | 'samsung' | 'other';

export function vendorKind(manufacturer: string): VendorKind {
  const m = manufacturer.toLowerCase();
  if (m.includes('xiaomi') || m.includes('redmi') || m.includes('poco')) {
    return 'xiaomi';
  }
  if (m.includes('samsung')) return 'samsung';
  return 'other';
}

const VENDOR_STEPS: Record<VendorKind, string> = {
  xiaomi:
    'Settings > Apps > Manage apps > DustBack: set Battery saver to No restrictions AND enable Autostart. Both are needed.',
  samsung: 'Settings > Apps > DustBack > Battery: set to Unrestricted.',
  other:
    'In your phone settings, allow DustBack to run in the background (battery: unrestricted), then try again.',
};

function deviceManufacturer(): string {
  const constants = Platform.constants as { Manufacturer?: string };
  return constants?.Manufacturer ?? '';
}

export default function ConnectTroubleshooting(props: {
  onRetry?: () => void;
  onDismiss: () => void;
}) {
  const t = useTheme();
  const steps = VENDOR_STEPS[vendorKind(deviceManufacturer())];

  return (
    <Card style={{ marginTop: 12 }}>
      <View
        style={{ flexDirection: 'row', justifyContent: 'space-between' }}
      >
        <Text style={{ color: t.text, fontSize: 15, fontWeight: '700' }}>
          Connection interrupted
        </Text>
        <Pressable onPress={props.onDismiss} hitSlop={10}>
          <Text style={{ color: t.textSecondary, fontSize: 15 }}>✕</Text>
        </Pressable>
      </View>

      <Text
        style={{
          color: t.textSecondary,
          fontSize: 13,
          marginTop: 6,
          lineHeight: 19,
        }}
      >
        Your phone likely closed DustBack in the background while switching to
        the wallet. This is common on Xiaomi, Redmi, POCO and Samsung.
      </Text>

      <Text
        style={{ color: t.text, fontSize: 13, marginTop: 10, lineHeight: 19 }}
      >
        {steps}
      </Text>

      <Text
        style={{
          color: t.textSecondary,
          fontSize: 13,
          marginTop: 10,
          lineHeight: 19,
        }}
      >
        Keep your wallet app unlocked and running before connecting.
      </Text>

      {props.onRetry && (
        <Btn
          title="Try again"
          variant="secondary"
          onPress={props.onRetry}
          style={{ marginTop: 12, paddingVertical: 10 }}
        />
      )}
    </Card>
  );
}
