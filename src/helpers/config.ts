import fs from "fs";
import path from "path";
import Axios, { AxiosInstance, AxiosResponse, AxiosError } from "axios";
import { ForbiddenError } from "@pullup.tech/cms";

export interface BaseConfig {
   apiContext: string;
   apiVersion: string;
   serverPort: number;
   smtpHost: string;
   smtpPort: number;
   smtpSecure: boolean;
   smtpPass: string;
   smtpUser: string;
   mailFrom: string;
   frontURL: string;
   jwtSecret: string;
   defaultPassword: string;
}
export class Config {
   private readonly _config: BaseConfig;
   private static _instance: Config;

   public static get instance() {
      if (!Config._instance) {
         Config._instance = new Config();
      }

      return Config._instance;
   }

   public get config() {
      return this._config;
   }

   private constructor() {
      this._config = this.readConfigFile();
   }

   private readConfigFile() {
      let config = null;

      if (process.cwd().includes("dist")) {
         config = fs.readFileSync(path.resolve("../pullup.config.json"));
      } else {
         config = fs.readFileSync(path.resolve("pullup.config.json"));
      }

      return JSON.parse(config.toString());
   }
}

export default class AsaasApiService {
   private _axiosInstance: AxiosInstance;

   constructor() {
      this._axiosInstance = Axios.create({
         baseURL: process.env.ASAAS_API_DATABASE_URL,
         headers: {
            "access-token": process.env.ASAAS_API_TOKEN as string,
         },
         timeout: 60000,
      });

      this._axiosInstance.interceptors.request.use(
         (config) => config,
         (error) => error
      );

      this._axiosInstance.interceptors.response.use(
         (response) => response,
         (error: AxiosError) => {
            if (error?.response?.data) {
               throw new ForbiddenError(JSON.stringify(error.response.data));
            }
         }
      );
   }

   public async get<T>(url: string): Promise<AxiosResponse<T>> {
      return this._axiosInstance.get<T>(url);
   }

   public async post<T>(url: string, data?: any): Promise<AxiosResponse<T>> {
      return this._axiosInstance.post<T>(url, data);
   }

   public async put<T>(url: string, data?: any): Promise<AxiosResponse<T>> {
      return this._axiosInstance.put<T>(url, data);
   }
}

export class ComteleApiService {
   private _axiosInstance: AxiosInstance;

   constructor() {
      this._axiosInstance = Axios.create({
         baseURL: process.env.COMTELE_API_DATABASE_URL,
         headers: {
            "auth-key": process.env.COMTELE_API_KEY as string,
         },
      });

      this._axiosInstance.interceptors.request.use(
         (config) => config,
         (error) => error
      );

      this._axiosInstance.interceptors.response.use(
         (response) => response,
         (error) => error
      );
   }

   public async post<T>(url: string, data?: any): Promise<AxiosResponse<T>> {
      return this._axiosInstance.post<T>(url, data);
   }

   public async put<T>(url: string, data?: any): Promise<AxiosResponse<T>> {
      return this._axiosInstance.put<T>(url, data);
   }
}
