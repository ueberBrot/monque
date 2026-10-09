export const createMongoClientDouble = (connect: () => Promise<void>, close: () => Promise<void>) =>
  class {
    connect = connect;
    close = close;
    private readonly database = {
      collection: () => ({ findOne: async () => await Promise.resolve({ version: "seeded" }) }),
    };
    db = () => this.database;
  };
