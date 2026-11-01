import type { Response } from "express"

type ResponseData<T>={
   statusCode:number,
   message:string,
   data?:T,
   meta?:unknown
}

export const sendResponse = <T>(res:Response,payload:ResponseData<T>)=>{
    res.status(payload.statusCode).json({
        success: true,
        message: payload.message,
        data: payload.data??null,
        meta: payload.meta
    })
}