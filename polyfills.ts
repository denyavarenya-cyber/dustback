// Must be imported before @solana/web3.js: RN provides neither crypto.getRandomValues nor Buffer.
import 'react-native-get-random-values';
import { Buffer } from 'buffer';

(global as any).Buffer = Buffer;
