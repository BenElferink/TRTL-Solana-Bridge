import type { NextApiRequest, NextApiResponse } from 'next'
import axios from 'axios'
import { firestore } from '@/utils/firebase'
import sleep from '@/functions/sleep'
import { DbMintPayload } from '@/@types'
import blockfrost from '@/utils/blockfrost'
import { ADA_SIDEKICK_TEAM_ADDRESS } from '@/constants'
import { getTxInfo } from './mint'

export const config = {
  maxDuration: 300,
  api: {
    responseLimit: false,
  },
}

const handler = async (req: NextApiRequest, res: NextApiResponse) => {
  const { method } = req

  try {
    switch (method) {
      case 'GET': {
        const collection = firestore.collection('turtle-sidekick-swaps')
        const txs = await blockfrost.addressesTransactionsAll(ADA_SIDEKICK_TEAM_ADDRESS)
        const now = Date.now()

        for await (const tx of txs) {
          let txTime: string | number = String(tx.block_time)
          while (txTime.length < 13) txTime = `${txTime}0`
          txTime = Number(txTime)

          if (now - txTime < 2 * 60 * 60 * 1000) {
            try {
              const txHash = tx.tx_hash
              const { empty, docs } = await collection.where('txHash', '==', txHash).get()
              const { didSend, didMint, timestamp } = docs[0].data() as DbMintPayload

              let docNeedsAgain = false
              if (
                (!didMint && didSend && now - timestamp >= 60000) || // 1 minutes
                (!didMint && !didSend && now - timestamp >= 300000) // 5 minutes
              ) {
                docNeedsAgain = true
              }

              const needTo = empty || docNeedsAgain
              const { sentLp, mintAmount } = needTo ? await getTxInfo(txHash) : { sentLp: false, mintAmount: 0 }

              if (needTo && sentLp && !!mintAmount) {
                console.log('found faulty TX, retrying now', txHash)

                await axios.post('https://trtl-solana-bridge.vercel.app/api/sidekick/mint', { txHash })
                await sleep(2000)
              }
            } catch (error) {}
          }
        }

        return res.status(204).end()
      }

      default: {
        res.setHeader('Allow', 'GET')
        return res.status(405).end()
      }
    }
  } catch (error) {
    console.error(error)
    return res.status(500).end()
  }
}

export default handler
