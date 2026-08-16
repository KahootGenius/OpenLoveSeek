import Constants, { ExecutionEnvironment } from 'expo-constants';

/** True when running inside the Expo Go client (not a standalone/dev build). */
export const isExpoGo =
  Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
