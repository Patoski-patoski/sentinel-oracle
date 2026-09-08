import { Injectable, Logger } from "@nestjs/common";
import { CognoDBService } from "../database/cognoDB.service.js";

@Injectable()
export class SeedService {
  private readonly logger = new Logger(SeedService.name);

  constructor(private readonly cognoDbService: CognoDBService) {}

  async seedDemoData(): Promise<{ success: boolean; message: string }> {
    this.logger.log({ event: "SEED_DEMO_DATA_TRIGGERED" });
    try {
      const session = this.cognoDbService.getSession();
      try {
        // 1. Create/Merge $MOON token and Wash Trading Loop (4 hops)
        await session.run(`
          MERGE (t:Token {symbol: 'MOON'})
          SET t.name = 'MoonShot Protocol', t.address = 'MOON_TOKEN_MINT_11111', t:DemoCluster

          MERGE (w1:Wallet {address: '7Y4d...WashMaster'})
          SET w1.label = 'Mastermind Wallet', w1:DemoCluster

          MERGE (w2:Wallet {address: '3Km9...WashNode2'})
          SET w2.label = 'Wash Ring Node 2', w2:DemoCluster

          MERGE (w3:Wallet {address: '8Pq1...WashNode3'})
          SET w3.label = 'Wash Ring Node 3', w3:DemoCluster

          MERGE (w4:Wallet {address: '2Xv7...WashNode4'})
          SET w4.label = 'Wash Ring Node 4', w4:DemoCluster

          MERGE (w1)-[r1:TRANSFERRED {tokenSymbol: 'MOON'}]->(w2)
          SET r1.amount = 4985.0, r1.timestamp = timestamp()

          MERGE (w2)-[r2:TRANSFERRED {tokenSymbol: 'MOON'}]->(w3)
          SET r2.amount = 4985.0, r2.timestamp = timestamp()

          MERGE (w3)-[r3:TRANSFERRED {tokenSymbol: 'MOON'}]->(w4)
          SET r3.amount = 4985.0, r3.timestamp = timestamp()

          MERGE (w4)-[r4:TRANSFERRED {tokenSymbol: 'MOON'}]->(w1)
          SET r4.amount = 4985.0, r4.timestamp = timestamp()
        `);

        // 2. Merge 12 Sybil bot wallets funded by mastermind
        for (let i = 1; i <= 12; i++) {
          await session.run(
            `
            MATCH (w1:Wallet {address: '7Y4d...WashMaster'}), (t:Token {symbol: 'MOON'})
            MERGE (b:Wallet {address: $botAddress})
            SET b.label = $botLabel, b:DemoCluster
            MERGE (w1)-[f:FUNDED]->(b)
            SET f.amount = 4.0, f.tokenSymbol = 'SOL', f.timestamp = timestamp()
            MERGE (b)-[s:SWAPPED]->(t)
            SET s.amount = 4.0, s.tokenSymbol = 'MOON', s.timestamp = timestamp()
          `,
            {
              botAddress: `BotSybil_${i.toString().padStart(2, "0")}`,
              botLabel: `Sybil Sniper #${i}`,
            },
          );
        }

        // 3. Merge Peeling Chain to Exchange
        await session.run(`
          MATCH (w1:Wallet {address: '7Y4d...WashMaster'})
          MERGE (h1:Wallet {address: 'PeelHop1...Addr'})
          SET h1.label = 'Peel Split 1', h1:DemoCluster

          MERGE (h2:Wallet {address: 'PeelHop2...Addr'})
          SET h2.label = 'Peel Split 2', h2:DemoCluster

          MERGE (h3:Wallet {address: 'PeelHop3...Addr'})
          SET h3.label = 'Peel Split 3', h3:DemoCluster

          MERGE (ex:Exchange {address: 'BinanceHotWallet11111'})
          SET ex.label = 'Binance Deposit Hot Wallet', ex:DemoCluster

          MERGE (w1)-[p1:TRANSFERRED {tokenSymbol: 'SOL'}]->(h1)
          SET p1.amount = 50.0

          MERGE (h1)-[p2:TRANSFERRED {tokenSymbol: 'SOL'}]->(h2)
          SET p2.amount = 45.0

          MERGE (h2)-[p3:TRANSFERRED {tokenSymbol: 'SOL'}]->(h3)
          SET p3.amount = 38.0

          MERGE (h3)-[p4:TRANSFERRED {tokenSymbol: 'SOL'}]->(ex)
          SET p4.amount = 35.0
        `);

        // 4. Merge benign token $SAFE
        await session.run(`
          MERGE (s:Token {symbol: 'SAFE'})
          SET s.name = 'SafeYield DAO', s.address = 'SAFE_TOKEN_MINT_22222', s:DemoCluster

          MERGE (user1:Wallet {address: 'NormalTraderA...Addr'})
          SET user1.label = 'Retail Trader A', user1:DemoCluster

          MERGE (user2:Wallet {address: 'NormalTraderB...Addr'})
          SET user2.label = 'Retail Trader B', user2:DemoCluster

          MERGE (user1)-[sw1:SWAPPED]->(s)
          SET sw1.amount = 10.0, sw1.tokenSymbol = 'SAFE'

          MERGE (user2)-[sw2:SWAPPED]->(s)
          SET sw2.amount = 15.0, sw2.tokenSymbol = 'SAFE'
        `);

        this.logger.log({ event: "SEED_DEMO_DATA_COMPLETED" });
        return {
          success: true,
          message: "Successfully seeded live CognoDB graph with demo clusters",
        };
      } finally {
        await session.close();
      }
    } catch (err) {
      this.logger.warn({
        event: "SEED_DEMO_DATA_OFFLINE",
        message:
          "CognoDB unavailable for live seeding, demo fallback generator ready",
        error: err instanceof Error ? err.message : String(err),
      });
      return {
        success: false,
        message: "CognoDB unavailable; fallback generator active.",
      };
    }
  }
}
