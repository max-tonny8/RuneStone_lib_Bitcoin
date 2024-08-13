import { MAX_DIVISIBILITY } from './src/constants';
import { Etching } from './src/etching';
import { Flaw as FlawEnum } from './src/flaw';
import { RuneEtchingSpec } from './src/indexer';
import { u128, u32, u64, u8 } from './src/integer';
import { None, Option, Some } from './src/monads';
import { RuneId } from './src/runeid';
import { Runestone, RunestoneTx } from './src/runestone';
import { SpacedRune } from './src/spacedrune';
import { Terms } from './src/terms';

export {
  BlockIdentifier,
  BlockInfo,
  RuneBalance,
  RuneBlockIndex,
  RuneEtching,
  RuneEtchingSpec,
  RuneLocation,
  RuneMintCount,
  RuneSpentUtxoBalance,
  RuneUpdater,
  RuneUtxoBalance,
  RunestoneIndexer,
  RunestoneIndexerOptions,
  RunestoneStorage,
} from './src/indexer';

export { Network } from './src/network';

export {
  BitcoinRpcClient,
  GetBlockParams,
  GetBlockReturn,
  GetBlockhashParams,
  GetRawTransactionParams,
  GetRawTransactionReturn,
  RpcResponse,
  Tx,
} from './src/rpcclient';

export type RunestoneSpec = {
  mint?: {
    block: bigint;
    tx: number;
  };
  pointer?: number;
  etching?: RuneEtchingSpec;
  edicts?: {
    id: {
      block: bigint;
      tx: number;
    };
    amount: bigint;
    output: number;
  }[];
};

export type Flaw =
  | 'edict_output'
  | 'edict_rune_id'
  | 'invalid_script'
  | 'opcode'
  | 'supply_overflow'
  | 'trailing_integers'
  | 'truncated_field'
  | 'unrecognized_even_tag'
  | 'unrecognized_flag'
  | 'varint';

export type Cenotaph = {
  flaws: Flaw[];
  etching?: string;
  mint?: {
    block: bigint;
    tx: number;
  };
};

function getFlawString(flaw: FlawEnum): Flaw {
  switch (flaw) {
    case FlawEnum.EDICT_OUTPUT:
      return 'edict_output';
    case FlawEnum.EDICT_RUNE_ID:
      return 'edict_rune_id';
    case FlawEnum.INVALID_SCRIPT:
      return 'invalid_script';
    case FlawEnum.OPCODE:
      return 'opcode';
    case FlawEnum.SUPPLY_OVERFLOW:
      return 'supply_overflow';
    case FlawEnum.TRAILING_INTEGERS:
      return 'trailing_integers';
    case FlawEnum.TRUNCATED_FIELD:
      return 'truncated_field';
    case FlawEnum.UNRECOGNIZED_EVEN_TAG:
      return 'unrecognized_even_tag';
    case FlawEnum.UNRECOGNIZED_FLAG:
      return 'unrecognized_flag';
    case FlawEnum.VARINT:
      return 'varint';
  }
}

// Helper functions to ensure numbers fit the desired type correctly
const u8Strict = (n: number) => {
  const bigN = BigInt(n);
  if (bigN < 0n || bigN > u8.MAX) {
    throw Error('u8 overflow');
  }
  return u8(bigN);
};
const u32Strict = (n: number) => {
  const bigN = BigInt(n);
  if (bigN < 0n || bigN > u32.MAX) {
    throw Error('u32 overflow');
  }
  return u32(bigN);
};
const u64Strict = (n: bigint) => {
  const bigN = BigInt(n);
  if (bigN < 0n || bigN > u64.MAX) {
    throw Error('u64 overflow');
  }
  return u64(bigN);
};
const u128Strict = (n: bigint) => {
  const bigN = BigInt(n);
  if (bigN < 0n || bigN > u128.MAX) {
    throw Error('u128 overflow');
  }
  return u128(bigN);
};

// TODO: Add unit tests
/**
 * Low level function to allow for encoding runestones without any indexer and transaction checks.
 *
 * @param runestone runestone spec to encode as runestone
 * @returns encoded runestone bytes
 * @throws Error if encoding is detected to be considered a cenotaph
 */
export function encodeRunestone(runestone: RunestoneSpec): {
  encodedRunestone: Buffer;
  etchingCommitment?: Buffer;
} {
  const mint = runestone.mint
    ? Some(new RuneId(u64Strict(runestone.mint.block), u32Strict(runestone.mint.tx)))
    : None;

  const pointer = runestone.pointer !== undefined ? Some(runestone.pointer).map(u32Strict) : None;

  const edicts = (runestone.edicts ?? []).map((edict) => ({
    id: new RuneId(u64Strict(edict.id.block), u32Strict(edict.id.tx)),
    amount: u128Strict(edict.amount),
    output: u32Strict(edict.output),
  }));

  let etching: Option<Etching> = None;
  let etchingCommitment: Buffer | undefined = undefined;
  if (runestone.etching) {
    const etchingSpec = runestone.etching;

    const spacedRune = etchingSpec.runeName
      ? SpacedRune.fromString(etchingSpec.runeName)
      : undefined;
    const rune = spacedRune?.rune !== undefined ? Some(spacedRune.rune) : None;

    if (
      etchingSpec.symbol &&
      !(
        etchingSpec.symbol.length === 1 ||
        (etchingSpec.symbol.length === 2 && etchingSpec.symbol.codePointAt(0)! >= 0x10000)
      )
    ) {
      throw Error('Symbol must be one code point');
    }

    const divisibility =
      etchingSpec.divisibility !== undefined ? Some(etchingSpec.divisibility).map(u8Strict) : None;
    const premine =
      etchingSpec.premine !== undefined ? Some(etchingSpec.premine).map(u128Strict) : None;
    const spacers =
      spacedRune?.spacers !== undefined && spacedRune.spacers !== 0
        ? Some(u32Strict(spacedRune.spacers))
        : None;
    const symbol = etchingSpec.symbol ? Some(etchingSpec.symbol) : None;

    if (divisibility.isSome() && divisibility.unwrap() > MAX_DIVISIBILITY) {
      throw Error(`Divisibility is greater than protocol max ${MAX_DIVISIBILITY}`);
    }

    let terms: Option<Terms> = None;
    if (etchingSpec.terms) {
      const termsSpec = etchingSpec.terms;

      const amount = termsSpec.amount !== undefined ? Some(termsSpec.amount).map(u128Strict) : None;
      const cap = termsSpec.cap !== undefined ? Some(termsSpec.cap).map(u128Strict) : None;
      const height: [Option<u64>, Option<u64>] = termsSpec.height
        ? [
            termsSpec.height.start !== undefined
              ? Some(termsSpec.height.start).map(u64Strict)
              : None,
            termsSpec.height.end !== undefined ? Some(termsSpec.height.end).map(u64Strict) : None,
          ]
        : [None, None];
      const offset: [Option<u64>, Option<u64>] = termsSpec.offset
        ? [
            termsSpec.offset.start !== undefined
              ? Some(termsSpec.offset.start).map(u64Strict)
              : None,
            termsSpec.offset.end !== undefined ? Some(termsSpec.offset.end).map(u64Strict) : None,
          ]
        : [None, None];

      if (amount.isSome() && cap.isSome() && amount.unwrap() * cap.unwrap() > u128.MAX) {
        throw Error('Terms overflow with amount times cap');
      }

      terms = Some({ amount, cap, height, offset });
    }

    const turbo = etchingSpec.turbo ?? false;

    etching = Some(new Etching(divisibility, rune, spacers, symbol, terms, premine, turbo));
    etchingCommitment = rune.isSome() ? rune.unwrap().commitment : undefined;
  }

  return {
    encodedRunestone: new Runestone(mint, pointer, edicts, etching).encipher(),
    etchingCommitment,
  };
}

export function isRunestone(artifact: RunestoneSpec | Cenotaph): artifact is RunestoneSpec {
  return !('flaws' in artifact);
}

export function tryDecodeRunestone(tx: RunestoneTx): RunestoneSpec | Cenotaph | null {
  const optionArtifact = Runestone.decipher(tx);
  if (optionArtifact.isNone()) {
    return null;
  }

  const artifact = optionArtifact.unwrap();
  if (artifact.type === 'runestone') {
    const runestone = artifact;

    const etching = () => runestone.etching.unwrap();
    const terms = () => etching().terms.unwrap();

    return {
      ...(runestone.etching.isSome()
        ? {
            etching: {
              ...(etching().divisibility.isSome()
                ? { divisibility: etching().divisibility.map(Number).unwrap() }
                : {}),
              ...(etching().premine.isSome() ? { premine: etching().premine.unwrap() } : {}),
              ...(etching().rune.isSome()
                ? {
                    runeName: new SpacedRune(
                      etching().rune.unwrap(),
                      etching().spacers.map(Number).unwrapOr(0)
                    ).toString(),
                  }
                : {}),
              ...(etching().symbol.isSome() ? { symbol: etching().symbol.unwrap() } : {}),
              ...(etching().terms.isSome()
                ? {
                    terms: {
                      ...(terms().amount.isSome() ? { amount: terms().amount.unwrap() } : {}),
                      ...(terms().cap.isSome() ? { cap: terms().cap.unwrap() } : {}),
                      ...(terms().height.find((option) => option.isSome())
                        ? {
                            height: {
                              ...(terms().height[0].isSome()
                                ? { start: terms().height[0].unwrap() }
                                : {}),
                              ...(terms().height[1].isSome()
                                ? { end: terms().height[1].unwrap() }
                                : {}),
                            },
                          }
                        : {}),
                      ...(terms().offset.find((option) => option.isSome())
                        ? {
                            offset: {
                              ...(terms().offset[0].isSome()
                                ? { start: terms().offset[0].unwrap() }
                                : {}),
                              ...(terms().offset[1].isSome()
                                ? { end: terms().offset[1].unwrap() }
                                : {}),
                            },
                          }
                        : {}),
                    },
                  }
                : {}),
              turbo: etching().turbo,
            },
          }
        : {}),
      ...(runestone.mint.isSome()
        ? {
            mint: {
              block: runestone.mint.unwrap().block,
              tx: Number(runestone.mint.unwrap().tx),
            },
          }
        : {}),
      ...(runestone.pointer.isSome() ? { pointer: Number(runestone.pointer.unwrap()) } : {}),
      ...(runestone.edicts.length
        ? {
            edicts: runestone.edicts.map((edict) => ({
              id: {
                block: edict.id.block,
                tx: Number(edict.id.tx),
              },
              amount: edict.amount,
              output: Number(edict.output),
            })),
          }
        : {}),
    };
  } else {
    const cenotaph = artifact;
    return {
      flaws: cenotaph.flaws.map(getFlawString),
      ...(cenotaph.etching.isSome() ? { etching: cenotaph.etching.unwrap().toString() } : {}),
      ...(cenotaph.mint.isSome()
        ? { mint: { block: cenotaph.mint.unwrap().block, tx: Number(cenotaph.mint.unwrap().tx) } }
        : {}),
    };
  }
}
