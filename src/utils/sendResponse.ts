import type { Response } from "express"

type ResponseData<T>={
   statusCode:number,
   message:string,
   data?:T,
   meta?:unknown
}

export const sendResponse = <t>(res:Response,payload:ResponseData<t>)=>{
    res.status(payload.statusCode).json({
        success: true,
        message: payload.message,
        data: payload.data??null,
        meta: payload.meta
    })
}