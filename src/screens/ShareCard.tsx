import { forwardRef } from 'react';
import { Image, Text, View } from 'react-native';
import { brand } from '../theme';

export interface ShareCardProps {
  usd: string;
  accountsClosed: number;
  netSol: string;
}

/** Rendered off-screen and captured for the native share sheet.
 *  Carries no address, signatures or balances — outcome totals only. */
const ShareCard = forwardRef<View, ShareCardProps>(function ShareCard(
  props,
  ref
) {
  return (
    <View
      ref={ref}
      collapsable={false}
      style={{
        position: 'absolute',
        left: -1000,
        top: 0,
        width: 340,
        height: 340,
        backgroundColor: brand.teal,
        padding: 26,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Image
          source={require('../../assets/brand/symbol-1024.png')}
          style={{ width: 30, height: 30, marginRight: 8 }}
        />
        <Text
          style={{ color: brand.paper, fontSize: 18, fontWeight: '700' }}
        >
          DustBack
        </Text>
      </View>

      <View style={{ flex: 1, justifyContent: 'center' }}>
        <Text style={{ color: brand.paper, opacity: 0.8, fontSize: 15 }}>
          Recovered
        </Text>
        <Text
          style={{ color: brand.paper, fontSize: 54, fontWeight: '700' }}
          numberOfLines={1}
          adjustsFontSizeToFit
        >
          {props.usd}
        </Text>
        <Text style={{ color: brand.paper, opacity: 0.8, fontSize: 15 }}>
          Returned to my wallet
        </Text>
      </View>

      <Text style={{ color: brand.paper, opacity: 0.8, fontSize: 14 }}>
        {props.accountsClosed}{' '}
        {props.accountsClosed === 1 ? 'account' : 'accounts'} closed ·{' '}
        {props.netSol}
      </Text>
    </View>
  );
});

export default ShareCard;
