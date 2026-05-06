import { Type } from '@sinclair/typebox';

export const CapabilitiesSchema = Type.Object(
	{
		readOnly: Type.Boolean(),
		actions: Type.Object(
			{
				read: Type.Boolean(),
				cancel: Type.Boolean(),
				retry: Type.Boolean(),
				reschedule: Type.Boolean(),
				delete: Type.Boolean(),
			},
			{ additionalProperties: false },
		),
	},
	{ $id: 'Capabilities', additionalProperties: false },
);
