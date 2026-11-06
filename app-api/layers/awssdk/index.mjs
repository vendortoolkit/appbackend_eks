// index.mjs - shared AWS SDK v3 exports
import {
  SSMClient,
  GetParametersCommand,
  PutParameterCommand,
} from '@aws-sdk/client-ssm'
import { DynamoDB } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocument, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { unmarshall } from '@aws-sdk/util-dynamodb'
import { BatchClient, SubmitJobCommand } from '@aws-sdk/client-batch' // ES Modules import
import {
  SQSClient,
  SendMessageCommand,
  SendMessageBatchCommand,
  DeleteMessageCommand,
} from '@aws-sdk/client-sqs'
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda'
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2'
import { CognitoIdentityProviderClient, AdminGetUserCommand } from '@aws-sdk/client-cognito-identity-provider'

const defaultRegion = 'eu-west-1'
const sharedConfig = { region: defaultRegion }

// Export class constructors and commonly used commands
export {
  SSMClient,
  GetParametersCommand,
  PutParameterCommand,
  DynamoDB,
  DynamoDBDocument,
  UpdateCommand,
  BatchClient,
  SubmitJobCommand,
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  SESv2Client,
  SendEmailCommand,
  SQSClient,
  SendMessageCommand,
  SendMessageBatchCommand,
  DeleteMessageCommand,
  LambdaClient,
  InvokeCommand,
  sharedConfig,
  CognitoIdentityProviderClient,
  AdminGetUserCommand,
  unmarshall,
}
