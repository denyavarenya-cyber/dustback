import { Button, Text, View } from 'react-native';
import { useSweeperStore } from '../store';

export default function DoneScreen() {
  const outcome = useSweeperStore((s) => s.outcome);
  const reset = useSweeperStore((s) => s.reset);

  if (!outcome) return null;

  return (
    <View>
      <Text style={{ fontSize: 24, fontWeight: 'bold', marginTop: 8 }}>
        Sweep complete
      </Text>
      <View style={{ marginTop: 24, marginBottom: 16 }}>
        <Button title="Scan another wallet" onPress={reset} />
      </View>
    </View>
  );
}
